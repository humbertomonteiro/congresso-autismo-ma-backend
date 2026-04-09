const CertificateService = require("../services/CertificateService");

class CouponController {
  async verifyCoupon(req, res) {
    try {
      //templateHTML: cientifica, monitoria, organizadora
      const { code } = req.body;
    } catch (error) {
      console.error("Erro no CertificateController:", error);
      res
        .status(500)
        .json({ error: error.message || "Erro ao gerar o certificado." });
    }
  }

  async createCoupon(req, res) {
    const normalizedCoupon = code.replace(/[\.-]/g, "");
  }

  async deleteCoupon(req, res) {}

  async updateCoupon(req, res) {
    const normalizedCoupon = updatedCoupon.replace(/[\.-]/g, "");
  }

  async getAllCoupons(req, res) {}
}

module.exports = new CouponController();
