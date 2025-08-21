const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/user');

const router = express.Router();

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Não autenticado. Token não fornecido.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
      if (err) {
        console.error('[AUTH] Falha JWT:', { errorName: err.name, errorMessage: err.message });
        if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
        if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Token inválido. Assinatura incorreta.' });
        return res.status(401).json({ error: 'Erro de autenticação.' });
      }
      req.userId = payload.sub;
      next();
    });
  } catch (e) {
    console.error('[AUTH] Erro inesperado no middleware:', e);
    return res.status(500).json({ error: 'Erro interno durante a autenticação.' });
  }
};

router.put(
  '/profile',
  authMiddleware,
  [
    body('nomeCompleto').notEmpty().withMessage('O nome completo é obrigatório.'),
    body('celular').notEmpty().withMessage('O celular é obrigatório.'),
    body('cep').notEmpty().withMessage('O CEP é obrigatório.'),
    body('logradouro').notEmpty().withMessage('O logradouro é obrigatório.'),
    body('numero').notEmpty().withMessage('O número é obrigatório.'),
    body('bairro').notEmpty().withMessage('O bairro é obrigatório.'),
    body('cidade').notEmpty().withMessage('A cidade é obrigatória.'),
    body('estado').notEmpty().withMessage('O estado é obrigatório.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const user = await User.findByPk(req.userId);
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

      const allowed = ['nomeCompleto', 'celular', 'cep', 'logradouro', 'numero', 'bairro', 'cidade', 'estado', 'complemento'];
      const updates = {};
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
          updates[key] = req.body[key];
        }
      }

      await user.update(updates);
      res.json({ message: 'Perfil atualizado com sucesso!', user });
    } catch (error) {
      console.error('Erro ao atualizar perfil:', error);
      res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
);

module.exports = router;
