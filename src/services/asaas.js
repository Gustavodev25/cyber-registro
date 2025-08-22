// services/asaas.js
const axios = require('axios');

/**
 * Ambientes e chaves:
 * - Defina ASAAS_API_KEY_PRODUCTION e ASAAS_API_KEY_SANDBOX nas variáveis de ambiente.
 * - Se só existir ASAAS_API_KEY, ela será usada como fallback para ambos (não recomendado).
 */
const ENVIRONMENTS = {
  sandbox: {
    baseURL: 'https://api-sandbox.asaas.com/v3',
    apiKey: process.env.ASAAS_API_KEY_SANDBOX || process.env.ASAAS_API_KEY || '',
  },
  production: {
    baseURL: 'https://api.asaas.com/v3',
    apiKey: process.env.ASAAS_API_KEY_PRODUCTION || process.env.ASAAS_API_KEY || '',
  },
};

/**
 * Resolve o ambiente a partir do request.
 * Regras:
 * - Header opcional: x-asaas-env: 'sandbox'|'production' (força)
 * - Se origin/host tiver cyberregistro.com.br ou onrender.com → production
 * - Se NODE_ENV === 'production' e não houver origin/host → production
 * - Caso contrário → sandbox
 */
function resolveEnvFromReq(req) {
  const forced = (req.headers['x-asaas-env'] || '').toString().trim().toLowerCase();
  if (forced === 'sandbox' || forced === 'production') return forced;

  const origin = (req.headers.origin || '').toLowerCase();
  const host = (req.headers.host || '').toLowerCase();

  const isProdDomain =
    /cyberregistro\.com\.br/.test(origin) ||
    /cyberregistro\.com\.br/.test(host) ||
    /onrender\.com$/.test(origin) ||
    /onrender\.com$/.test(host);

  if (isProdDomain) return 'production';
  if (process.env.NODE_ENV === 'production' && !origin && !host) return 'production';
  return 'sandbox';
}

function buildAxios(env) {
  const cfg = ENVIRONMENTS[env];
  if (!cfg || !cfg.apiKey) {
    const msg = `[ASAAS] ❌ API key ausente para ambiente "${env}". Verifique variáveis ASAAS_API_KEY_${env.toUpperCase()}.`;
    console.error(msg);
    const err = new Error(msg);
    err.name = 'ConfigError';
    throw err;
  }

  return axios.create({
    baseURL: cfg.baseURL,
    headers: {
      'Content-Type': 'application/json',
      'access_token': cfg.apiKey,
    },
    timeout: 20000,
  });
}

function asaasErrorFromAxios(error) {
  const first = error?.response?.data?.errors?.[0] || {};
  const err = new Error(first.description || error.message || 'Erro no gateway');
  err.name = 'AsaasError';
  err.code = first.code || null;
  err.status = error?.response?.status || null;
  err.raw = error?.response?.data || null;
  // MUITO IMPORTANTE: preserva response para o caller
  err.response = error?.response;
  return err;
}

/** Busca cliente existente por CPF ou por email. Retorna ID ou null. */
async function findExistingCustomer(api, { cpf, email }) {
  try {
    if (cpf) {
      const { data } = await api.get('/customers', { params: { cpfCnpj: cpf } });
      if (Array.isArray(data?.data) && data.data.length > 0) return data.data[0].id || null;
    }
  } catch (_) { /* ignora */ }
  try {
    if (email) {
      const { data } = await api.get('/customers', { params: { email } });
      if (Array.isArray(data?.data) && data.data.length > 0) return data.data[0].id || null;
    }
  } catch (_) { /* ignora */ }
  return null;
}

/**
 * Retorna um client do Asaas para o ambiente escolhido.
 * Uso típico no route: const asaas = getAsaasClient(req);
 */
function getAsaasClient(reqOrEnv) {
  const env = typeof reqOrEnv === 'string' ? reqOrEnv : resolveEnvFromReq(reqOrEnv);
  const api = buildAxios(env);

  return {
    env,

    /** Idempotente: se já existir cliente com mesmo CPF/email, reaproveita. */
    async createCustomer(user) {
      try {
        const cpf = String(user.cpf || '').replace(/\D/g, '') || undefined;
        const email = user.email || undefined;

        const existingId = await findExistingCustomer(api, { cpf, email });
        if (existingId) return existingId;

        const payload = {
          name: user.nomeCompleto || user.name || user.fullName || 'Cliente',
          email: email,
          cpfCnpj: cpf,
          mobilePhone: String(user.celular || '').replace(/\D/g, '') || undefined,
          address: user.logradouro || undefined,
          addressNumber: user.numero || undefined,
          complement: user.complemento || undefined,
          province: user.bairro || undefined,
          postalCode: String(user.cep || '').replace(/\D/g, '') || undefined,
        };

        const { data } = await api.post('/customers', payload);
        return data.id;
      } catch (e) {
        console.error('[ASAAS] Erro ao criar cliente:', e.response?.data || e.message);
        throw asaasErrorFromAxios(e);
      }
    },

    async createPayment(order) {
      try {
        const { data } = await api.post('/payments', order);
        return data;
      } catch (e) {
        console.error('[ASAAS] Erro ao criar pagamento:', e.response?.data || e.message);
        throw asaasErrorFromAxios(e);
      }
    },

    async getPayment(paymentId) {
      try {
        const { data } = await api.get(`/payments/${paymentId}`);
        return data;
      } catch (e) {
        console.error('[ASAAS] Erro ao obter pagamento:', e.response?.data || e.message);
        throw asaasErrorFromAxios(e);
      }
    },

    async getPixQrCode(paymentId) {
      try {
        const { data } = await api.get(`/payments/${paymentId}/pixQrCode`);
        return data;
      } catch (e) {
        console.error('[ASAAS] Erro ao obter PIX QRCode:', e.response?.data || e.message);
        throw asaasErrorFromAxios(e);
      }
    },
  };
}

module.exports = {
  getAsaasClient,
  resolveEnvFromReq,
};