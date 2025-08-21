const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const sequelize = require('../db/connection');
const asaas = require('../services/asaas');
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
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { quantity, paymentMethod, card, couponCode } = req.body;
    const user = req.user;

    try {
      if (process.env.APP_REQUIRE_ADDRESS === 'true' && (!user.cep || !user.numero)) {
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
        });
        if (!coupon) return res.status(404).json({ error: 'Cupom inválido ou expirado.' });
        if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
          return res.status(400).json({ error: 'Este cupom atingiu o limite de usos.' });
        }

        appliedCoupon = coupon;
        if (coupon.discountType === 'percentage') {
          const discount = (finalValue * parseFloat(coupon.value)) / 100;
          discountValue = parseFloat(discount.toFixed(2));
          finalValue = parseFloat((finalValue - discount).toFixed(2));
        } else {
          const discount = parseFloat(coupon.value);
          discountValue = parseFloat(discount.toFixed(2));
          finalValue = parseFloat((finalValue - discount).toFixed(2));
        }

        if (finalValue < MIN_CHARGE) finalValue = MIN_CHARGE;
      }

      let customerId = user.asaasCustomerId;
      if (!customerId) {
        customerId = await asaas.createCustomer(user);
        user.asaasCustomerId = customerId;
        await user.save();
      }

      const billingType = paymentMethod === 'pix' ? 'PIX' : 'CREDIT_CARD';
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);

      const order = {
        customer: customerId,
        billingType,
        dueDate: dueDate.toISOString().split('T')[0],
        value: finalValue,
        description,
        externalReference: `USER:${user.id}|QTY:${quantity}|COUPON:${appliedCoupon ? appliedCoupon.code : '-'}`,
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

      const payment = await asaas.createPayment(order);
      const isConfirmed = payment.status === 'CONFIRMED' || payment.status === 'RECEIVED';

      let paymentDetails = null;
      if (isConfirmed) {
        try { paymentDetails = await asaas.getPayment(payment.id); } catch { paymentDetails = null; }
      }

      const asaasPaymentDate =
        parseGatewayDate(paymentDetails?.paymentDate) ||
        parseGatewayDate(payment?.paymentDate) ||
        null;

      const asaasConfirmedDate =
        parseGatewayDate(paymentDetails?.confirmedDate) ||
        parseGatewayDate(payment?.confirmedDate) ||
        null;

      const paidAt = isConfirmed ? (asaasConfirmedDate || asaasPaymentDate || new Date()) : null;

      let updatedCredits = user.credits;

      await sequelize.transaction(async (t) => {
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
          asaasPaymentDate,
          asaasConfirmedDate,
        }, { transaction: t });

        if (isConfirmed) {
          await user.increment('credits', { by: quantity, transaction: t });
          if (appliedCoupon) await appliedCoupon.increment('usesCount', { by: 1, transaction: t });
          // **INÍCIO DA CORREÇÃO**
          // Recalcula o valor para garantir consistência
          updatedCredits = user.credits + quantity;
          // **FIM DA CORREÇÃO**
        }
      });

      let responsePayload = {
        paymentId: payment.id,
        status: payment.status,
        value: finalValue,
        discount: discountValue,
        invoiceUrl: payment.invoiceUrl || null,
        paidAt: paidAt ? new Date(paidAt).toISOString() : null,
      };

      // **INÍCIO DA CORREÇÃO**
      // Se o pagamento foi confirmado imediatamente, anexa o novo saldo de créditos à resposta.
      if (isConfirmed) {
        responsePayload.updatedCredits = updatedCredits;
      }
      // **FIM DA CORREÇÃO**

      if (billingType === 'PIX') {
        try {
          const qr = await asaas.getPixQrCode(payment.id);
          responsePayload.pix = {
            imageSrc: `data:image/png;base64,${qr.encodedImage}`,
            copyAndPaste: qr.payload,
            expiresAt: qr.expirationDate || payment.dueDate || null,
            invoiceUrl: payment.invoiceUrl || null,
          };
        } catch (qrErr) {
          console.error('Falha ao obter QRCode PIX:', qrErr.message);
          responsePayload.pix = {
            imageSrc: null,
            copyAndPaste: null,
            expiresAt: payment.dueDate || null,
            invoiceUrl: payment.invoiceUrl || null,
          };
        }
      }

      return res.status(201).json(responsePayload);
    } catch (error) {
      console.error('Erro ao criar ordem de pagamento:', error.response?.data || error.message);
      return res.status(500).json({ error: 'Falha ao criar cobrança.' });
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
    console.error('[STATUS] Falha ao consultar status:', err.message);
    return res.json({ status: 'PENDING' });
  }
});

// ====== WEBHOOK DO ASAAS ======
router.post('/webhook', async (req, res) => {
  const { event, payment } = req.body || {};
  const webhookToken = req.headers['asaas-webhook-token'];

  if (webhookToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
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

        // Emite para a SALA do pagamento (não depende de socketId)
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
    console.error('[WEBHOOK] Erro ao processar webhook:', err.message);
    return res.sendStatus(200);
  }
});

module.exports = router;
