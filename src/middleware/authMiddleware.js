const jwt = require('jsonwebtoken');
const User = require('../models/user');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso negado. Nenhum token fornecido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Encontra o usuário pelo ID contido no token
    const user = await User.findByPk(decoded.sub);

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    // Anexa o usuário ao objeto de requisição para uso posterior
    req.user = user;
    next();
  } catch (error) {
    res.status(400).json({ error: 'Token inválido.' });
  }
};

module.exports = authMiddleware;
