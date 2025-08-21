const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const User = require('../models/user.js');

const router = express.Router();

const signToken = (user, rememberMe) => {
  const payload = { sub: user.id, email: user.email };
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'troque_este_segredo' || secret.length < 32) {
    console.error('[AUTH] ❌ ERRO CRÍTICO: JWT_SECRET não está configurado ou é inseguro.');
  }
  const expiresIn = rememberMe ? '7d' : (process.env.JWT_EXPIRES_IN || '8h');
  return jwt.sign(payload, secret, { expiresIn });
};

router.post(
  '/register',
  body('nomeCompleto').notEmpty().withMessage('O nome completo é obrigatório.'),
  body('cpf').isLength({ min: 14, max: 14 }).withMessage('CPF inválido.'),
  body('celular').notEmpty().withMessage('O celular é obrigatório.'),
  body('email').isEmail().withMessage('Email inválido.'),
  body('password').isLength({ min: 6 }).withMessage('A senha deve ter no mínimo 6 caracteres.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const { nomeCompleto, cpf, celular, email, password } = req.body;

      const existingUser = await User.findOne({ where: { [Op.or]: [{ email }, { cpf }] } });
      if (existingUser) {
        if (existingUser.email === email) return res.status(409).json({ error: 'Este email já está cadastrado.' });
        if (existingUser.cpf === cpf) return res.status(409).json({ error: 'Este CPF já está cadastrado.' });
      }

      const createdUser = await User.create({ nomeCompleto, cpf, celular, email, password });
      return res.status(201).json({
        message: 'Usuário criado com sucesso!',
        user: { id: createdUser.id, nomeCompleto: createdUser.nomeCompleto, email: createdUser.email, credits: createdUser.credits },
      });
    } catch (err) {
      console.error('Erro no registro:', err);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
);

router.post(
  '/login',
  body('email').isEmail().withMessage('Email inválido.'),
  body('password').notEmpty().withMessage('A senha é obrigatória.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const { email, password, rememberMe } = req.body;
      const user = await User.scope('withPassword').findOne({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Email ou senha inválidos.' });

      const isPasswordCorrect = await user.checkPassword(password);
      if (!isPasswordCorrect) return res.status(401).json({ error: 'Email ou senha inválidos.' });

      const token = signToken(user, rememberMe);
      return res.json({
        message: 'Login bem-sucedido!',
        token,
        user: { id: user.id, nomeCompleto: user.nomeCompleto, email: user.email, credits: user.credits },
      });
    } catch (err) {
      console.error('Erro no login:', err);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
);

module.exports = router;
