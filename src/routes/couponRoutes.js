const express = require('express');
const router = express.Router();
const CouponController = require('../controllers/CouponController');
const { verifyToken, requireAdm } = require('../middleware/authMiddleware');

// Rota pública — usada pelo checkout e pagamento manual
router.post('/validate', CouponController.validate);

// Rotas protegidas — apenas adm
router.use(verifyToken, requireAdm);
router.get('/', CouponController.getAll);
router.post('/', CouponController.create);
router.put('/:id', CouponController.update);
router.delete('/:id', CouponController.delete);

module.exports = router;
