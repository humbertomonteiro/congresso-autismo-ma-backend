const { firebase: { admin, db } } = require('../config');

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.sendResponse(401, false, 'Token não fornecido');
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch {
    return res.sendResponse(401, false, 'Token inválido ou expirado');
  }
}

async function requireAdm(req, res, next) {
  if (!req.user) return res.sendResponse(401, false, 'Não autenticado');
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'adm') {
      return res.sendResponse(403, false, 'Acesso negado: apenas administradores');
    }
    next();
  } catch {
    return res.sendResponse(500, false, 'Erro ao verificar permissões');
  }
}

/**
 * Lê a role do usuário no Firestore e anexa em req.userRole.
 * Permite apenas roles com acesso ao checkout manual: adm, suporte, vendedor.
 */
async function requireManualCheckoutAccess(req, res, next) {
  if (!req.user) return res.sendResponse(401, false, 'Não autenticado');
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.sendResponse(403, false, 'Usuário não encontrado');
    }
    const role = userDoc.data().role;
    const allowed = ['adm', 'suporte', 'vendedor'];
    if (!allowed.includes(role)) {
      return res.sendResponse(403, false, 'Acesso negado');
    }
    req.userRole = role;
    next();
  } catch {
    return res.sendResponse(500, false, 'Erro ao verificar permissões');
  }
}

module.exports = { verifyToken, requireAdm, requireManualCheckoutAccess };
