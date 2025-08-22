// routes/payment.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const sequelize = require('../db/connection');
const { getAsaasClient, resolveEnvFromReq } = require('../services/asaas');
const User = require('../models/user');
const Transaction = require('../models/Transaction');
const Coupon = require('../models/Coupon');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();
const MIN_CHARGE = 0.01;

const getCreditPrice = (quantity) => {
  if (quantity >= 1 && quantity <= 10) return 49.90;
  if (quantity >= 11 && quantity <= 30) return 47.90;
  if (quantity >= 31 && quantity <= 50) return 45.90;
  if (quantity >= 51 && quantity <= 100) return 42.90;
  if (quantity >= 101) return 39.90;
  return 49.90;
};

const parseGatewayDate = (v) => (v ? new Date(v) : null);

// ====== CRIA ORDEM (PIX/CARTÃO) ======
router.post(
  '/create-order',
  authMiddleware,
  [
    body('quantity').isInt({ min: 1 }).withMessage('A quantidade deve ser um número inteiro positivo.'),
    body('paymentMethod').isIn(['pix', 'card']).withMessage('Método de pagamento inválido.'),
    body('couponCode').optional().isString().trim(),
    body('card').optional().isObject(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { quantity, paymentMethod, card, couponCode } = req.body;
    const user = req.user;

    const env = resolveEnvFromReq(req); // ← escolhe sandbox/prod automaticamente
    const asaas = getAsaasClient(env);

    const dbTransaction = await sequelize.transaction();
    try {
      if (process.env.APP_REQUIRE_ADDRESS === 'true' && (!user.cep || !user.numero)) {
        await dbTransaction.rollback();
        return res.status(400).json({ error: 'É necessário completar seu endereço no perfil antes de comprar.' });
      }

      const unitPrice = getCreditPrice(quantity);
      const totalAmount = parseFloat((unitPrice * quantity).toFixed(2));
      const description = `Compra de ${quantity} créditos`;

      let finalValue = totalAmount;
      let discountValue = 0;
      let appliedCoupon = null;

      if (couponCode) {
        const coupon = await Coupon.findOne({
          where: {
            code: couponCode.toUpperCase(),
            isActive: true,
            expiresAt: { [Op.or]: { [Op.eq]: null, [Op.gt]: new Date() } },
          },
          transaction: dbTransaction,
          lock: true,
        });

        if (!coupon) {
          await dbTransaction.rollback();
          return res.status(404).json({ error: 'Cupom inválido ou expirado.' });
        }
        if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
          await dbTransaction.rollback();
          return res.status(400).json({ error: 'Este cupom atingiu o limite de usos.' });
        }

        appliedCoupon = coupon;
        if (coupon.discountType === 'percentage') {
          discountValue = parseFloat(((finalValue * parseFloat(coupon.value)) / 100).toFixed(2));
        } else {
          discountValue = parseFloat(parseFloat(coupon.value).toFixed(2));
        }
        finalValue = parseFloat((finalValue - discountValue).toFixed(2));
        if (finalValue < MIN_CHARGE) finalValue = MIN_CHARGE;
      }

      // Obter/registrar cliente (idempotente)
      let customerId = user.asaasCustomerId || null;
      if (!customerId) {
        customerId = await asaas.createCustomer(user);
        user.asaasCustomerId = customerId;
        await user.save({ transaction: dbTransaction });
      }

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);

      const orderPayload = {
        customer: customerId,
        billingType: paymentMethod === 'pix' ? 'PIX' : 'CREDIT_CARD',
        dueDate: dueDate.toISOString().split('T')[0],
        value: finalValue,
        description,
        externalReference: `ENV:${env}|USER:${user.id}|QTY:${quantity}|COUPON:${appliedCoupon ? appliedCoupon.code : '-'}`,
        creditCard: paymentMethod === 'card' ? {
          holderName: card?.holderName,
          number: String(card?.number || '').replace(/\s/g, ''),
          expiryMonth: card?.expiryMonth,
          expiryYear: card?.expiryYear,
          ccv: card?.ccv,
        } : undefined,
        creditCardHolderInfo: paymentMethod === 'card' ? {
          name: user.nomeCompleto,
          email: user.email,
          cpfCnpj: String(user.cpf || '').replace(/\D/g, ''),
          postalCode: String(user.cep || '').replace(/\D/g, ''),
          addressNumber: user.numero,
          mobilePhone: String(user.celular || '').replace(/\D/g, '').slice(-11),
        } : undefined,
      };

      let payment;
      try {
        payment = await asaas.createPayment(orderPayload);
      } catch (error) {
        // ✅ AGORA conseguimos identificar o erro do Asaas
        const isAsaasInvalidCustomer = error?.name === 'AsaasError' && error?.code === 'invalid_customer';

        if (isAsaasInvalidCustomer) {
          console.warn(`[ASAAS] ID de cliente inválido/obsoleto (env=${env}) para usuário ${user.id}. Recriando...`);
          try {
            // Cria/recupera cliente novamente (idempotente)
            const newCustomerId = await asaas.createCustomer(user);
            user.asaasCustomerId = newCustomerId;
            await user.save({ transaction: dbTransaction });

            orderPayload.customer = newCustomerId;
            payment = await asaas.createPayment(orderPayload);
            console.log(`[ASAAS] Cliente refeito e pagamento criado (env=${env}) para usuário ${user.id}.`);
          } catch (retryError) {
            await dbTransaction.rollback();
            const msg = retryError?.message || 'Falha na segunda tentativa de cobrança.';
            console.error('[ASAAS] Nova tentativa falhou:', retryError?.raw || retryError);
            return res.status(500).json({ error: `Falha ao criar cobrança: ${msg}` });
          }
        } else {
          await dbTransaction.rollback();
          const msg = error?.message || 'Erro desconhecido do gateway.';
          console.error('[ASAAS] Erro ao criar pagamento:', error?.raw || msg);
          return res.status(500).json({ error: `Falha ao criar cobrança: ${msg}` });
        }
      }

      const isConfirmed = payment.status === 'CONFIRMED' || payment.status === 'RECEIVED';
      const paidAt = isConfirmed ? (parseGatewayDate(payment.confirmedDate) || parseGatewayDate(payment.paymentDate) || new Date()) : null;

      await Transaction.create({
        userId: user.id,
        asaasPaymentId: payment.id,
        description,
        quantity,
        unitPrice,
        totalAmount,
        value: finalValue,
        discount: discountValue,
        couponCode: appliedCoupon ? appliedCoupon.code : null,
        status: isConfirmed ? 'CONFIRMED' : 'PENDING',
        paymentMethod,
        paidAt,
        asaasStatus: payment.status || null,
        asaasPaymentDate: parseGatewayDate(payment.paymentDate),
        asaasConfirmedDate: parseGatewayDate(payment.confirmedDate),
      }, { transaction: dbTransaction });

      let updatedCredits = user.credits;
      if (isConfirmed) {
        await user.increment('credits', { by: quantity, transaction: dbTransaction });
        if (appliedCoupon) await appliedCoupon.increment('usesCount', { by: 1, transaction: dbTransaction });
        updatedCredits += quantity;
      }

      await dbTransaction.commit();

      const responsePayload = {
        paymentId: payment.id,
        status: payment.status,
        value: finalValue,
        discount: discountValue,
        invoiceUrl: payment.invoiceUrl || null,
        paidAt: paidAt ? new Date(paidAt).toISOString() : null,
        updatedCredits: isConfirmed ? updatedCredits : undefined,
      };

      if (payment.billingType === 'PIX' && !isConfirmed) {
        try {
          const qr = await asaas.getPixQrCode(payment.id);
          responsePayload.pix = {
            imageSrc: `data:image/png;base64,${qr.encodedImage}`,
            copyAndPaste: qr.payload,
            expiresAt: qr.expirationDate || payment.dueDate || null,
          };
        } catch (qrErr) {
          console.error('[ASAAS] Falha ao obter QRCode PIX:', qrErr?.message);
        }
      }

      return res.status(201).json(responsePayload);
    } catch (error) {
      await dbTransaction.rollback();
      console.error('Erro geral ao criar ordem de pagamento:', error?.message || error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
);

// ====== STATUS (fallback/polling) ======
router.get('/status/:paymentId', authMiddleware, async (req, res) => {
  const { paymentId } = req.params;

  try {
    const txn = await Transaction.findOne({
      where: { asaasPaymentId: paymentId, userId: req.user.id },
    });
    if (!txn) return res.status(404).json({ error: 'Transação não encontrada.' });

    if (txn.status === 'CONFIRMED') {
      const user = await User.findByPk(req.user.id);
      return res.json({
        status: 'CONFIRMED',
        updatedCredits: user?.credits,
        paidAt: txn.paidAt ? new Date(txn.paidAt).toISOString() : null,
      });
    }

    const env = resolveEnvFromReq(req);
    const asaas = getAsaasClient(env);

    const p = await asaas.getPayment(paymentId);
    const isConfirmed = p.status === 'CONFIRMED' || p.status === 'RECEIVED';

    if (!isConfirmed) return res.json({ status: p.status || 'PENDING' });

    let updatedCredits = undefined;
    await sequelize.transaction(async (t) => {
      const locked = await Transaction.findOne({
        where: { id: txn.id },
        transaction: t,
        lock: true,
      });

      if (locked.status !== 'CONFIRMED') {
        const user = await User.findByPk(req.user.id, { transaction: t, lock: true });
        if (user) {
          await user.increment('credits', { by: locked.quantity, transaction: t });
          updatedCredits = user.credits + locked.quantity;
        }

        const asaasPaymentDate = p.paymentDate ? new Date(p.paymentDate) : null;
        const asaasConfirmedDate = p.confirmedDate ? new Date(p.confirmedDate) : null;

        locked.status = 'CONFIRMED';
        locked.asaasStatus = p.status || null;
        if (asaasPaymentDate) locked.asaasPaymentDate = asaasPaymentDate;
        if (asaasConfirmedDate) locked.asaasConfirmedDate = asaasConfirmedDate;
        locked.paidAt = asaasConfirmedDate || asaasPaymentDate || new Date();
        await locked.save({ transaction: t });

        if (locked.couponCode) {
          await Coupon.increment('usesCount', {
            by: 1,
            where: { code: locked.couponCode },
            transaction: t,
          });
        }
      }
    });

    return res.json({
      status: 'CONFIRMED',
      updatedCredits,
      paidAt: txn.paidAt ? new Date(txn.paidAt).toISOString() : null,
    });
  } catch (err) {
    console.error('[STATUS] Falha ao consultar status:', err?.message || err);
    return res.json({ status: 'PENDING' });
  }
});

// ====== WEBHOOK DO ASAAS ======
router.post('/webhook', async (req, res) => {
  const { event, payment } = req.body || {};
  const webhookToken = req.headers['asaas-webhook-token'];

  const validTokens = new Set([
    process.env.ASAAS_WEBHOOK_TOKEN,
    process.env.ASAAS_WEBHOOK_TOKEN_PRODUCTION,
    process.env.ASAAS_WEBHOOK_TOKEN_SANDBOX,
  ].filter(Boolean));

  if (!validTokens.has(webhookToken)) {
    return res.status(403).send('Acesso negado.');
  }

  if (!payment?.id) {
    return res.sendStatus(200);
  }

  const isConfirmEvent = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'].includes(event);
  const isCancelEvent = ['PAYMENT_CANCELLED', 'PAYMENT_DELETED'].includes(event);
  const isRefundEvent = ['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK', 'PAYMENT_REVERSED'].includes(event);

  const asaasStatus = payment.status || null;
  const asaasPaymentDate = payment.paymentDate ? new Date(payment.paymentDate) : null;
  const asaasConfirmedDate = payment.confirmedDate ? new Date(payment.confirmedDate) : null;

  try {
    await sequelize.transaction(async (t) => {
      const txn = await Transaction.findOne({
        where: { asaasPaymentId: payment.id },
        transaction: t,
        lock: true,
      });

      if (!txn) return;

      txn.asaasStatus = asaasStatus;
      if (asaasPaymentDate) txn.asaasPaymentDate = asaasPaymentDate;
      if (asaasConfirmedDate) txn.asaasConfirmedDate = asaasConfirmedDate;

      if (isConfirmEvent && txn.status === 'PENDING') {
        const user = await User.findByPk(txn.userId, { transaction: t, lock: true });
        if (user) await user.increment('credits', { by: txn.quantity, transaction: t });

        txn.status = 'CONFIRMED';
        txn.paidAt = asaasConfirmedDate || asaasPaymentDate || new Date();

        if (txn.couponCode) {
          const coupon = await Coupon.findOne({
            where: { code: txn.couponCode },
            transaction: t,
            lock: true,
          });
          if (coupon) await coupon.increment('usesCount', { by: 1, transaction: t });
        }

        await txn.save({ transaction: t });

        const userAfter = await User.findByPk(txn.userId, { transaction: t });
        req.io.to(`pay:${payment.id}`).emit('payment_confirmed', {
          paymentId: payment.id,
          updatedCredits: userAfter ? userAfter.credits : undefined,
          paidAt: txn.paidAt ? new Date(txn.paidAt).toISOString() : null,
        });
        return;
      }

      if ((isCancelEvent || isRefundEvent) && txn.status === 'CONFIRMED') {
        const user = await User.findByPk(txn.userId, { transaction: t, lock: true });
        if (user) {
          const toRemove = Math.min(user.credits, txn.quantity);
          if (toRemove > 0) await user.decrement('credits', { by: toRemove, transaction: t });
        }
        txn.status = isRefundEvent ? 'REFUNDED' : 'CANCELLED';
        await txn.save({ transaction: t });
        return;
      }

      await txn.save({ transaction: t });
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error('[WEBHOOK] Erro ao processar webhook:', err?.message || err);
    return res.sendStatus(200);
  }
});

module.exports = router;