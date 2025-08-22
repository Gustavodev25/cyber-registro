const { Sequelize } = require('sequelize');

// =================== INÍCIO DA CORREÇÃO ===================
// A importação e configuração do 'dotenv' também foram removidas deste arquivo
// para seguir a abordagem de configuração centralizada no 'server.js'.
// =================== FIM DA CORREÇÃO ===================

// Pega as credenciais do banco de dados a partir das variáveis de ambiente
const {
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_HOST,
  DB_PORT,
  DB_SSL,
  DATABASE_URL // Adicionado para suportar a URL de conexão completa (ex: Render, Heroku)
} = process.env;

let sequelize;

// Verifica se a DATABASE_URL está definida. Se estiver, usa-a para a conexão.
// Isso é comum em ambientes de produção como Render, Heroku, etc.
if (DATABASE_URL) {
  sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Necessário para algumas plataformas de nuvem
      }
    },
    logging: false, // Desativa os logs SQL no console
  });
} else {
  // Caso contrário, usa as credenciais separadas (ambiente de desenvolvimento)
  sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'postgres',
    dialectOptions: {
      // Converte o valor da string 'false' para um booleano
      ssl: DB_SSL === 'true' ? { require: true, rejectUnauthorized: false } : false,
    },
    logging: console.log, // Mostra logs SQL no console durante o desenvolvimento
  });
}

module.exports = sequelize;
