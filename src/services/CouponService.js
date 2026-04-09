const fs = require("fs").promises;
const { generateCertificatePDF } = require("../utils/templateUtils");

class CouponService {
  async verifyCoupon(code) {
    if (code) {
      throw new Error("Código obrigatório.");
    }

    try {
      // Normaliza o CPF (remove pontos e traços)
      const normalizedCoupon = code.replace(/[\.-]/g, "");
    } catch (error) {
      console.error("Erro no CouponService:", error);
      throw new Error("Falha ao verificar cupom.");
    }
  }

  async createCoupon(code) {
    const normalizedCoupon = code.replace(/[\.-]/g, "");
  }

  async deleteCoupon(codeId) {}

  async updateCoupon(codeId, updatedCoupon) {
    const normalizedCoupon = updatedCoupon.replace(/[\.-]/g, "");
  }

  async getAllCoupons() {}
}

module.exports = new CouponService();
