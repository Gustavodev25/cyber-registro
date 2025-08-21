// backend/src/models/Coupon.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/connection');

class Coupon extends Model {}

Coupon.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    code: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'O código do cupom que o usuário irá digitar. Ex: NATAL20',
      // NÃO usar unique: true aqui (bug no sync/alter do Postgres)
      set(val) {
        const v = (val ?? '').toString().trim().toUpperCase();
        this.setDataValue('code', v);
      },
    },

    // ⚠️ REMOVIDO o comment daqui para evitar o erro "USING" no Postgres
    discountType: {
      type: DataTypes.ENUM('percentage', 'fixed'),
      allowNull: false,
    },

    value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment:
        'O valor do desconto. Se for percentage, é 10 para 10%. Se for fixed, é 10 para R$10,00.',
      validate: {
        isDecimal: true,
        min(value) {
          if (Number(value) < 0) {
            throw new Error('O valor do desconto não pode ser negativo.');
          }
        },
      },
    },

    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'A data de expiração do cupom. Nulo se não expirar.',
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      comment: 'Indica se o cupom está ativo e pode ser usado.',
    },

    maxUses: {
      type: DataTypes.INTEGER,
      allowNull: true, // Nulo para usos ilimitados
      comment: 'Número máximo de vezes que este cupom pode ser usado no total.',
      validate: { min: 1 },
    },

    usesCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
      comment: 'Quantas vezes este cupom já foi utilizado.',
      validate: { min: 0 },
    },
  },
  {
    sequelize,
    modelName: 'Coupon',
    tableName: 'coupons',
    timestamps: true,

    // ✅ Unicidade via índice (compatível com Postgres no sync/alter)
    indexes: [
      {
        name: 'coupons_code_unique',
        unique: true,
        fields: ['code'],
      },
    ],
  }
);

module.exports = Coupon;
