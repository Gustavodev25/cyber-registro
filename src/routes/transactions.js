const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const Transaction = require('../models/Transaction');
const User = require('../models/user'); // Importar o model User

const router = express.Router();

// ROTA ATUALIZADA PARA BUSCAR O HISTÓRICO DE TODAS AS TRANSAÇÕES
router.get(
  '/',
  authMiddleware, // TODO: Idealmente, esta rota deve ser protegida para ser acessível apenas por administradores.
  async (req, res) => {
    try {
      // Busca todas as transações, incluindo os dados do usuário associado a cada uma.
      const transactions = await Transaction.findAll({
        order: [
          ['createdAt', 'DESC'], // Ordena da mais recente para a mais antiga
        ],
        include: [{
          model: User,
          as: 'user',
          // CORREÇÃO: Pega o nome completo e o email do usuário
          attributes: ['nomeCompleto', 'email'],
          required: false, // Garante que a query não falhe se um usuário for deletado.
        }],
        attributes: {
          exclude: ['updatedAt', 'asaasPaymentId', 'asaasStatus', 'asaasPaymentDate', 'asaasConfirmedDate']
        }
      });

      res.status(200).json(transactions);
    } catch (error) {
      console.error('Erro ao buscar histórico de transações:', error);
      res.status(500).json({ error: 'Erro interno do servidor ao buscar histórico.' });
    }
  }
);

module.exports = router;
