const { firebase: { admin, db } } = require('../config');

const UserController = {
  async listUsers(req, res) {
    try {
      const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.sendResponse(200, true, 'Usuários listados', users);
    } catch (err) {
      res.sendResponse(500, false, 'Erro ao listar usuários', null, err.message);
    }
  },

  async createUser(req, res) {
    try {
      const { name, email, password, role, sellerId, sellerName } = req.body;

      if (!name || !email || !password || !role) {
        return res.sendResponse(400, false, 'Campos obrigatórios: name, email, password, role');
      }

      const validRoles = ['adm', 'viewer', 'scanner', 'vendedor'];
      if (!validRoles.includes(role)) {
        return res.sendResponse(400, false, `Role inválida. Use: ${validRoles.join(', ')}`);
      }

      if (role === 'vendedor' && !sellerId) {
        return res.sendResponse(400, false, 'Vendedor precisa estar vinculado a um vendedor cadastrado');
      }

      const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: name,
      });

      const userData = {
        uid: userRecord.uid,
        name,
        email,
        role,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (role === 'vendedor' && sellerId) {
        userData.sellerId = sellerId;
        userData.sellerName = sellerName || '';
      }

      await db.collection('users').doc(userRecord.uid).set(userData);

      res.sendResponse(201, true, 'Usuário criado com sucesso', { uid: userRecord.uid });
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        return res.sendResponse(409, false, 'Este e-mail já está em uso');
      }
      res.sendResponse(500, false, 'Erro ao criar usuário', null, err.message);
    }
  },

  async updateUser(req, res) {
    try {
      const { uid } = req.params;
      const { name, role, sellerId, sellerName } = req.body;

      const validRoles = ['adm', 'viewer', 'scanner', 'vendedor'];
      if (role && !validRoles.includes(role)) {
        return res.sendResponse(400, false, `Role inválida. Use: ${validRoles.join(', ')}`);
      }

      if (role === 'vendedor' && !sellerId) {
        return res.sendResponse(400, false, 'Vendedor precisa estar vinculado a um vendedor cadastrado');
      }

      const update = {};
      if (name) update.name = name;
      if (role) update.role = role;

      if (role === 'vendedor' && sellerId) {
        update.sellerId = sellerId;
        update.sellerName = sellerName || '';
      } else if (role && role !== 'vendedor') {
        update.sellerId = admin.firestore.FieldValue.delete();
        update.sellerName = admin.firestore.FieldValue.delete();
      }

      await db.collection('users').doc(uid).update(update);

      if (name) {
        await admin.auth().updateUser(uid, { displayName: name });
      }

      res.sendResponse(200, true, 'Usuário atualizado com sucesso');
    } catch (err) {
      res.sendResponse(500, false, 'Erro ao atualizar usuário', null, err.message);
    }
  },

  async deleteUser(req, res) {
    try {
      const { uid } = req.params;

      // Impede que o admin apague a si mesmo
      if (req.user.uid === uid) {
        return res.sendResponse(400, false, 'Você não pode remover sua própria conta');
      }

      await admin.auth().deleteUser(uid);
      await db.collection('users').doc(uid).delete();

      res.sendResponse(200, true, 'Usuário removido com sucesso');
    } catch (err) {
      res.sendResponse(500, false, 'Erro ao remover usuário', null, err.message);
    }
  },
};

module.exports = UserController;
