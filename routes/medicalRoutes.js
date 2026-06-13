// routes/medicalRoutes.js
const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');
const { authenticateToken } = require('../middleware/auth');
const requireAdmin           = require('../middleware/requireAdmin');
const MedicalController      = require('../controllers/medicalController');

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isImage = file.mimetype.startsWith('image/');
    const ext     = file.originalname.split('.').pop().toLowerCase();
    const timestamp = Date.now();

    if (isImage) {
      return {
        folder:          'veterinaria/fichas_medicas',
        resource_type:   'image',
        allowed_formats: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
      };
    } else {
      // PDFs: la extensión DEBE ir en el public_id para que el navegador lo abra bien
      return {
        folder:        'veterinaria/fichas_medicas',
        resource_type: 'raw',
        public_id:     `${timestamp}.${ext}`,
      };
    }
  },
});

const fileFilter = (req, file, cb) => {
  const ok = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  ok.includes(file.mimetype) ? cb(null, true) : cb(null, false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/medical-records',        authenticateToken,             MedicalController.listByPet);
router.get('/medical-records/:id',    authenticateToken,             MedicalController.getById);
router.post('/medical-records',       authenticateToken, requireAdmin, upload.single('file'), MedicalController.create);
router.put('/medical-records/:id',    authenticateToken, requireAdmin, upload.single('file'), MedicalController.update);
router.delete('/medical-records/:id', authenticateToken, requireAdmin, MedicalController.remove);

module.exports = router;