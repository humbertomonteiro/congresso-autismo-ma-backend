/**
 * CouponService
 *
 * Estrutura de um cupom no Firestore (collection "coupons"):
 *   code          string   — código em letras minúsculas, único
 *   description   string   — descrição livre (uso interno)
 *   discountType  "fixed" | "percent"
 *   discountValue number   — R$ por ingresso inteiro (fixed) OU % sobre o subtotal (percent)
 *   minTickets    number   — mínimo de ingressos inteiros exigido (0 = sem mínimo)
 *   active        boolean
 *   expiresAt     Timestamp | null
 *   createdAt     Timestamp
 *
 * Regras de cálculo:
 *   fixed:   discount = discountValue * allTickets
 *   percent: discount = (subtotal) * (discountValue / 100)
 *
 * Em ambos os casos, minTickets é validado contra allTickets.
 */

const CouponRepository = require('../repositories/CouponRepository');

const CouponService = {
  /**
   * Retorna todos os cupons (para o painel do adm).
   */
  async getAll() {
    return CouponRepository.getAll();
  },

  /**
   * Busca um cupom pelo código e calcula o desconto para a compra.
   * Lança Error com mensagem amigável em caso de cupom inválido/expirado/condição não atendida.
   *
   * @param {string} code
   * @param {number} allTickets    — qtd ingressos inteiros
   * @param {number} halfTickets
   * @param {number} socialTickets
   * @returns {{ coupon, discount: number }}
   */
  async validateAndCalculate(code, allTickets, halfTickets, socialTickets) {
    if (!code || !code.trim()) throw new Error('Informe o código do cupom.');

    const normalizedCode = code.trim().toLowerCase();
    const coupon = await CouponRepository.getByCode(normalizedCode);

    if (!coupon) throw new Error('Cupom inválido.');
    if (!coupon.active) throw new Error('Este cupom não está mais ativo.');

    if (coupon.expiresAt) {
      const expiry = coupon.expiresAt.toDate ? coupon.expiresAt.toDate() : new Date(coupon.expiresAt);
      if (expiry < new Date()) throw new Error('Este cupom está expirado.');
    }

    if (coupon.minTickets && coupon.minTickets > 0 && allTickets < coupon.minTickets) {
      throw new Error(
        `Este cupom exige no mínimo ${coupon.minTickets} ingresso(s) inteiro(s).`
      );
    }

    const config = require('../config');
    const ALL_TICKET_VALUE = config.valueTickets.allTicket;
    const HALF_TICKET_VALUE = config.valueTickets.halfTicket;
    const SOCIAL_TICKET_VALUE = config.valueTickets.socialTicket;

    const subtotal =
      allTickets * ALL_TICKET_VALUE +
      halfTickets * HALF_TICKET_VALUE +
      socialTickets * SOCIAL_TICKET_VALUE;

    let discount = 0;
    if (coupon.discountType === 'fixed') {
      discount = coupon.discountValue * allTickets;
    } else if (coupon.discountType === 'percent') {
      discount = subtotal * (coupon.discountValue / 100);
    }

    // Garante que o desconto não ultrapasse o subtotal
    discount = Math.min(discount, subtotal);

    return { coupon, discount: parseFloat(discount.toFixed(2)) };
  },

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async create({ code, description, discountType, discountValue, minTickets, active, expiresAt }) {
    if (!code) throw new Error('Código do cupom é obrigatório.');
    if (!['fixed', 'percent'].includes(discountType))
      throw new Error('Tipo de desconto inválido. Use "fixed" ou "percent".');
    if (discountValue == null || discountValue < 0)
      throw new Error('Valor de desconto inválido.');
    if (discountType === 'percent' && discountValue > 100)
      throw new Error('Desconto percentual não pode ser maior que 100%.');

    const normalizedCode = code.trim().toLowerCase();

    const existing = await CouponRepository.getByCode(normalizedCode);
    if (existing) throw new Error(`Já existe um cupom com o código "${normalizedCode}".`);

    return CouponRepository.create({
      code: normalizedCode,
      description: description || '',
      discountType,
      discountValue: parseFloat(discountValue),
      minTickets: parseInt(minTickets) || 0,
      active: active !== false,
      expiresAt: expiresAt || null,
    });
  },

  async update(id, { code, description, discountType, discountValue, minTickets, active, expiresAt }) {
    if (!id) throw new Error('ID do cupom é obrigatório.');

    const update = {};
    if (code !== undefined) update.code = code.trim().toLowerCase();
    if (description !== undefined) update.description = description;
    if (discountType !== undefined) {
      if (!['fixed', 'percent'].includes(discountType))
        throw new Error('Tipo de desconto inválido.');
      update.discountType = discountType;
    }
    if (discountValue !== undefined) update.discountValue = parseFloat(discountValue);
    if (minTickets !== undefined) update.minTickets = parseInt(minTickets) || 0;
    if (active !== undefined) update.active = Boolean(active);
    if (expiresAt !== undefined) update.expiresAt = expiresAt || null;

    await CouponRepository.update(id, update);
  },

  async delete(id) {
    if (!id) throw new Error('ID do cupom é obrigatório.');
    await CouponRepository.delete(id);
  },
};

module.exports = CouponService;
