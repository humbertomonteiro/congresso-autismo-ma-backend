const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const { verifyToken, requireAdm } = require('../middleware/authMiddleware');

// Todas as rotas exigem token válido + role adm
router.use(verifyToken, requireAdm);

router.get('/', UserController.listUsers);
router.post('/', UserController.createUser);
router.put('/:uid', UserController.updateUser);
router.delete('/:uid', UserController.deleteUser);

module.exports = router;
