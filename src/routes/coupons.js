const express = require('express');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const Coupon = require('../models/Coupon');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Rota para criar um novo cupom (protegida e com lógica aprimorada)
router.post(
  '/',
  authMiddleware,
  [
    body('code').notEmpty().withMessage('O código é obrigatório.'),
    body('discountType').isIn(['percentage', 'fixed']).withMessage('Tipo de desconto inválido.'),
    body('value').isDecimal({ decimal_digits: '2' }).withMessage('O valor deve ser um número decimal.'),
    body('expiresAt').optional({ checkFalsy: true }).isISO8601().toDate().withMessage('Data de expiração inválida.'),
    body('maxUses').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('O número máximo de usos deve ser um inteiro positivo.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { code, discountType, value, expiresAt, maxUses } = req.body;

      // --- LÓGICA APRIMORADA: "Encontre ou Crie" ---
      // Se o cupom com este código já existir, ele será encontrado.
      // Se não existir, será criado. Isso evita o erro de "código duplicado".
      const [coupon, created] = await Coupon.findOrCreate({
        where: { code: code.toUpperCase() }, // Salva o código em maiúsculas para evitar duplicidade
        defaults: {
          discountType,
          value,
          expiresAt: expiresAt || null,
          maxUses: maxUses || null,
          isActive: true,
        },
      });

      // Se 'created' for false, significa que o cupom já existia.
      if (!created) {
        // Você pode optar por retornar um erro amigável ou simplesmente o cupom encontrado
        return res.status(200).json({ message: `Cupom '${code.toUpperCase()}' já existia.`, coupon });
      }

      // Se foi criado, retorna o status 201
      res.status(201).json(coupon);

    } catch (error) {
      console.error('Erro ao criar cupom:', error);
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }
);

// Rota para listar todos os cupons (protegida)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const coupons = await Coupon.findAll({
      order: [['createdAt', 'DESC']],
    });
    res.json(coupons);
  } catch (error) {
    console.error('Erro ao listar cupons:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota para validar um cupom
router.post(
  '/validate',
  [body('code').notEmpty().withMessage('O código do cupom é obrigatório.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { code } = req.body;
      const coupon = await Coupon.findOne({
        where: {
          code: code.toUpperCase(), // Valida o código em maiúsculas
          isActive: true,
          expiresAt: {
            [Op.or]: {
              [Op.eq]: null,
              [Op.gt]: new Date(),
            },
          },
        },
      });

      if (!coupon) {
        return res.status(404).json({ error: 'Cupom inválido ou expirado.' });
      }
      
      if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
        return res.status(400).json({ error: 'Este cupom atingiu o limite de usos.' });
      }

      res.json({
        message: 'Cupom válido!',
        coupon: {
          code: coupon.code,
          discountType: coupon.discountType,
          value: coupon.value,
        },
      });
    } catch (error)
    {
      console.error('Erro ao validar cupom:', error);
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }
);

module.exports = router;
