const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/connection');
const User = require('./user');

class Transaction extends Model {}

Transaction.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: User,
        key: 'id',
      },
    },

    // ⚠️ NÃO usar unique: true aqui (Postgres não aceita UNIQUE junto do ALTER TYPE).
    asaasPaymentId: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'ID da cobrança no Asaas (ou identificador sintético em casos especiais).',
    },

    description: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Descrição do item comprado. Ex: Compra de 10 créditos',
    },

    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 },
      comment: 'Quantidade de créditos adquiridos.',
    },

    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: 'Preço por unidade de crédito no momento da compra.',
    },

    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: 'Valor total original, antes de descontos.',
    },

    discount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Valor do desconto aplicado.',
    },

    couponCode: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Código do cupom aplicado (se houver).',
    },

    value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: 'Valor final efetivamente cobrado/pago.',
    },

    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'PENDING', // PENDING, CONFIRMED, FAILED, CANCELLED, REFUNDED
      comment: 'Status interno da transação.',
    },

    paymentMethod: {
      type: DataTypes.STRING,
      allowNull: false, // pix, card
    },

    // ====== Campos para hora exata do pagamento ======
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Instante em que o pagamento foi confirmado (hora exata usada internamente).',
    },

    // ====== Snapshot do gateway ======
    asaasStatus: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Status bruto retornado pelo Asaas.',
    },
    asaasPaymentDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Data/hora de pagamento informada pelo Asaas (se disponível).',
    },
    asaasConfirmedDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Data/hora de confirmação informada pelo Asaas (se disponível).',
    },
  },
  {
    sequelize,
    modelName: 'Transaction',
    tableName: 'transactions',
    timestamps: true,
    indexes: [
      { fields: ['userId'] },
      // ✅ Unicidade via índice (evita ALTER ... TYPE ... UNIQUE no Postgres)
      { unique: true, fields: ['asaasPaymentId'], name: 'transactions_asaas_payment_id_unique' },
      { fields: ['status'] },
    ],
  }
);

module.exports = Transaction;
