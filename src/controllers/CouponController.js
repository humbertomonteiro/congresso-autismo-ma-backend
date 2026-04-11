const CouponService = require('../services/CouponService');

const CouponController = {
  async getAll(req, res) {
    try {
      const coupons = await CouponService.getAll();
      res.sendResponse(200, true, 'Cupons listados', coupons);
    } catch (err) {
      res.sendResponse(500, false, 'Erro ao listar cupons', null, err.message);
    }
  },

  async create(req, res) {
    try {
      const { code, description, discountType, discountValue, minTickets, active, expiresAt } = req.body;
      const id = await CouponService.create({ code, description, discountType, discountValue, minTickets, active, expiresAt });
      res.sendResponse(201, true, 'Cupom criado com sucesso', { id });
    } catch (err) {
      res.sendResponse(400, false, err.message);
    }
  },

  async update(req, res) {
    try {
      const { id } = req.params;
      await CouponService.update(id, req.body);
      res.sendResponse(200, true, 'Cupom atualizado com sucesso');
    } catch (err) {
      res.sendResponse(400, false, err.message);
    }
  },

  async delete(req, res) {
    try {
      const { id } = req.params;
      await CouponService.delete(id);
      res.sendResponse(200, true, 'Cupom removido com sucesso');
    } catch (err) {
      res.sendResponse(400, false, err.message);
    }
  },

  // Rota pública usada pelo checkout (não exige autenticação de adm)
  async validate(req, res) {
    try {
      const { coupon, allTickets, halfTickets, socialTickets } = req.body;
      const allT = parseInt(allTickets) || 0;
      const halfT = parseInt(halfTickets) || 0;
      const socialT = parseInt(socialTickets) || 0;

      const { coupon: couponData, discount } = await CouponService.validateAndCalculate(
        coupon, allT, halfT, socialT
      );

      res.sendResponse(200, true, 'Cupom válido', {
        valid: true,
        discountType: couponData.discountType,
        discountValue: couponData.discountValue,
        discount,
      });
    } catch (err) {
      res.sendResponse(400, false, err.message, { valid: false });
    }
  },
};

module.exports = CouponController;
