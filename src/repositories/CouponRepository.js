const { firebase: { db, admin } } = require('../config');

const COLLECTION = 'coupons';

const CouponRepository = {
  async getAll() {
    const snap = await db.collection(COLLECTION).orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async getByCode(code) {
    const snap = await db
      .collection(COLLECTION)
      .where('code', '==', code.trim().toLowerCase())
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  },

  async create(data) {
    const ref = await db.collection(COLLECTION).add({
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },

  async update(id, data) {
    await db.collection(COLLECTION).doc(id).update(data);
  },

  async delete(id) {
    await db.collection(COLLECTION).doc(id).delete();
  },
};

module.exports = CouponRepository;
