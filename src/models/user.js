const { DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const sequelize = require('../db/connection');

const User = sequelize.define('User', {
  nomeCompleto: {
    type: DataTypes.STRING,
    allowNull: false
  },
  cpf: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      is: /^\d{3}\.\d{3}\.\d{3}-\d{2}$/
    }
  },
  celular: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  credits: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },

  // ===== Asaas =====
  // ⚠️ NÃO usar unique: true aqui (isso causa ALTER ... TYPE ... UNIQUE no Postgres)
  asaasCustomerId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'ID do cliente no Asaas para reuso em novas cobranças.'
  },

  // --- Campos de endereço ---
  cep: { type: DataTypes.STRING, allowNull: true },
  logradouro: { type: DataTypes.STRING, allowNull: true },
  numero: { type: DataTypes.STRING, allowNull: true },
  bairro: { type: DataTypes.STRING, allowNull: true },
  cidade: { type: DataTypes.STRING, allowNull: true },
  estado: { type: DataTypes.STRING, allowNull: true },
  complemento: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: 'usuarios',
  indexes: [
    { unique: true, fields: ['email'] },
    { unique: true, fields: ['cpf'] },
    // ✅ Unicidade do asaasCustomerId via índice (compatível com Postgres no sync/alter)
    { unique: true, fields: ['asaasCustomerId'], name: 'usuarios_asaas_customer_id_unique' },
  ],
  defaultScope: {
    attributes: { exclude: ['password'] }
  },
  scopes: {
    withPassword: { attributes: { include: ['password'] } }
  }
});

// Hooks de senha
User.addHook('beforeCreate', async (user) => {
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(user.password, salt);
});

User.addHook('beforeUpdate', async (user) => {
  if (user.changed('password')) {
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(user.password, salt);
  }
});

// Método para verificar a senha
User.prototype.checkPassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = User;
