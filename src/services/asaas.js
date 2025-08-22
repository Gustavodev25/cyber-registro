const axios = require('axios');

// =================== INÍCIO DA CORREÇÃO ===================
// A importação e configuração do 'dotenv' foram removidas deste arquivo.
// A configuração agora é centralizada no 'server.js' para evitar
// inconsistências e garantir que as variáveis corretas sejam carregadas.
// =================== FIM DA CORREÇÃO ===================

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_ENV = process.env.ASAAS_ENV || 'sandbox';

// Adicionada uma verificação para garantir que a chave da API foi carregada
if (!ASAAS_API_KEY) {
  console.error('[ASAAS] ❌ ERRO CRÍTICO: A variável de ambiente ASAAS_API_KEY não foi definida.');
  throw new Error('A chave da API do Asaas não está configurada.');
}

const environments = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};

const api = axios.create({
  baseURL: environments[ASAAS_ENV],
  headers: {
    'Content-Type': 'application/json',
    'access_token': ASAAS_API_KEY,
  },
});

const createCustomer = async (user) => {
  try {
    const payload = {
      name: user.nomeCompleto,
      email: user.email,
      cpfCnpj: String(user.cpf || '').replace(/\D/g, ''),
      mobilePhone: String(user.celular || '').replace(/\D/g, ''),
      address: user.logradouro || undefined,
      addressNumber: user.numero || undefined,
      complement: user.complemento || undefined,
      province: user.bairro || undefined,
      postalCode: String(user.cep || '').replace(/\D/g, ''),
    };
    const response = await api.post('/customers', payload);
    return response.data.id;
  } catch (error) {
    console.error('Erro ao criar cliente no Asaas:', error.response?.data || error.message);
    throw new Error('Falha ao registrar cliente no gateway de pagamento.');
  }
};

const createPayment = async (order) => {
  try {
    const response = await api.post('/payments', order);
    return response.data;
  } catch (error) {
    console.error('Erro ao criar pagamento no Asaas:', error.response?.data || error.message);
    const asaasError = error.response?.data?.errors?.[0]?.description || 'Erro desconhecido do gateway.';
    throw new Error(`Falha ao criar cobrança: ${asaasError}`);
  }
};

const getPayment = async (paymentId) => {
  try {
    const response = await api.get(`/payments/${paymentId}`);
    return response.data;
  } catch (error) {
    console.error('Erro ao obter pagamento no Asaas:', error.response?.data || error.message);
    const asaasError = error.response?.data?.errors?.[0]?.description || 'Erro desconhecido ao buscar pagamento.';
    throw new Error(`Falha ao obter pagamento: ${asaasError}`);
  }
};

const getPixQrCode = async (paymentId) => {
  try {
    const response = await api.get(`/payments/${paymentId}/pixQrCode`);
    return response.data;
  } catch (error) {
    console.error('Erro ao obter QRCode PIX no Asaas:', error.response?.data || error.message);
    const asaasError = error.response?.data?.errors?.[0]?.description || 'Erro desconhecido ao obter QRCode PIX.';
    throw new Error(`Falha ao obter QRCode PIX: ${asaasError}`);
  }
};

module.exports = {
  createCustomer,
  createPayment,
  getPayment,
  getPixQrCode,
};
