const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage: storage });
const DB_FILE = path.join(__dirname, 'db.json');

function getDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ adminSettings: { upiId: "yourupi@upi", adminWhatsapp: "919876543210" }, vendors: [] }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!data.adminSettings) { data.adminSettings = { upiId: "yourupi@upi", adminWhatsapp: "919876543210" }; }
  return data;
}
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

app.get('/api/admin/settings', (req, res) => { res.json(getDB().adminSettings); });
app.post('/api/admin/settings', (req, res) => {
  const db = getDB();
  const { upiId, adminWhatsapp } = req.body;
  if (upiId) db.adminSettings.upiId = upiId;
  if (adminWhatsapp) db.adminSettings.adminWhatsapp = adminWhatsapp;
  saveDB(db);
  res.json({ success: true });
});

app.get('/api/admin/vendors', (req, res) => { res.json(getDB().vendors); });

app.post('/api/vendors/register', (req, res) => {
  const db = getDB();
  const { storeName, whatsappNumber, password, planType } = req.body;
  if (!storeName || !whatsappNumber || !password || !planType) return res.status(400).json({ success: false, message: "Fill all fields!" });
  const storeId = storeName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  if (db.vendors.find(v => v.id === storeId)) return res.status(400).json({ success: false, message: "Store name already taken!" });
  
  let expiryDate = new Date();
  let status = "pending";

  if (planType === 'trial') {
    expiryDate.setDate(expiryDate.getDate() + 7);
    status = "active";
  } else if (planType === '1') {
    expiryDate.setMonth(expiryDate.getMonth() + 1);
  } else if (planType === '3') {
    expiryDate.setMonth(expiryDate.getMonth() + 3);
  } else if (planType === '12') {
    expiryDate.setMonth(expiryDate.getMonth() + 12);
  }

  db.vendors.push({
    id: storeId,
    storeName,
    whatsappNumber,
    password,
    status: status,
    planType: planType === 'trial' ? '7 Days Trial' : `${planType} Month(s)`,
    expiryDate: expiryDate.toISOString(),
    announcement: "🔥 Special Offer: Free Delivery on all orders today!",
    products: []
  });
  saveDB(db);
  res.json({ success: true, storeId });
});

app.post('/api/vendors/login', (req, res) => {
  const db = getDB();
  const { whatsappNumber, password } = req.body;
  const vendor = db.vendors.find(v => v.whatsappNumber === whatsappNumber && v.password === password);
  if (!vendor) {
    return res.status(401).json({ success: false, message: "WhatsApp Number or Password incorrect!" });
  }
  res.json({ success: true, storeId: vendor.id });
});

app.post('/api/admin/vendor/reset-password', (req, res) => {
  const db = getDB();
  const { storeId, newPassword } = req.body;
  const store = db.vendors.find(v => v.id === storeId);
  if (!store) return res.status(404).json({ success: false, message: "Store not found" });
  store.password = newPassword;
  saveDB(db);
  res.json({ success: true, message: "Password Reset Successful!" });
});

app.post('/api/admin/vendor/update-status', (req, res) => {
  const db = getDB();
  const { storeId, status, extendMonths } = req.body;
  const store = db.vendors.find(v => v.id === storeId);
  if (!store) return res.status(404).json({ success: false });
  if (status) store.status = status;
  if (extendMonths) {
    let exp = new Date(store.expiryDate);
    if (exp < new Date()) exp = new Date();
    exp.setMonth(exp.getMonth() + Number(extendMonths));
    store.expiryDate = exp.toISOString();
    store.status = "active";
  }
  saveDB(db);
  res.json({ success: true });
});

app.delete('/api/admin/vendor/:storeId', (req, res) => {
  const db = getDB();
  db.vendors = db.vendors.filter(v => v.id !== req.params.storeId);
  saveDB(db);
  res.json({ success: true });
});

app.get('/api/store/:storeId', (req, res) => {
  const db = getDB();
  const store = db.vendors.find(v => v.id === req.params.storeId);
  if (!store) return res.status(404).json({ error: "Not found" });
  if (new Date(store.expiryDate) < new Date() && store.status === 'active') { store.status = 'expired'; saveDB(db); }
  res.json({ store, adminSettings: db.adminSettings });
});

// Update Store Announcement / Offer Banner
app.post('/api/store/:storeId/announcement', (req, res) => {
  const db = getDB();
  const store = db.vendors.find(v => v.id === req.params.storeId);
  if (!store) return res.status(404).json({ success: false, message: "Store not found" });
  store.announcement = req.body.announcement || "";
  saveDB(db);
  res.json({ success: true, message: "Announcement updated successfully!" });
});

app.post('/api/store/:storeId/products', upload.array('images', 5), (req, res) => {
  const db = getDB();
  const store = db.vendors.find(v => v.id === req.params.storeId);
  if (!store || store.status !== 'active') return res.status(403).json({ success: false, message: "Inactive!" });
  const { name, price, details, category, badge, colors, sizes } = req.body;
  const images = req.files && req.files.length > 0 ? req.files.map(f => `/uploads/${f.filename}`) : ["https://images.pexels.com/photos/788946/pexels-photo-788946.jpeg?auto=compress&cs=tinysrgb&w=600"];
  
  // unshift to put newest product at the top
  store.products.unshift({
    id: Date.now(),
    name,
    price: Number(price),
    details,
    category: category || "General",
    badge: badge || "",
    colors: colors ? colors.split(',').map(c => c.trim()).filter(Boolean) : [],
    sizes: sizes ? sizes.split(',').map(s => s.trim()).filter(Boolean) : [],
    images
  });
  saveDB(db);
  res.json({ success: true, message: "Product Added Successfully!" });
});

app.delete('/api/store/:storeId/products/:productId', (req, res) => {
  const db = getDB();
  const store = db.vendors.find(v => v.id === req.params.storeId);
  if (!store) return res.status(404).json({ error: "Not found" });
  store.products = store.products.filter(p => p.id !== Number(req.params.productId));
  saveDB(db);
  res.json({ success: true });
});

app.post('/api/order/whatsapp/:storeId', (req, res) => {
  const db = getDB();
  const store = db.vendors.find(v => v.id === req.params.storeId);
  if (!store || store.status !== 'active') return res.status(403).json({ error: "Inactive." });
  const { productName, price, customerName, customerAddress, color, size } = req.body;
  
  let msg = `Hello *${store.storeName}*,\n\n🛒 *ORDER THAR:*\n📱 *Product:* ${productName}\n💰 *Price:* ₹${price.toLocaleString()}`;
  if(color) msg += `\n🎨 *Color:* ${color}`;
  if(size) msg += `\n📏 *Size/Storage:* ${size}`;
  msg += `\n\n👤 *CUSTOMER DETAILS:*\nName: ${customerName}\n📍 Address: ${customerAddress}`;

  const cleanNum = store.whatsappNumber.replace(/[^0-9]/g, '');
  const encodedMsg = encodeURIComponent(msg);
  const waUrl = `whatsapp://send?phone=${cleanNum}&text=${encodedMsg}`;

  res.json({ waUrl });
});

app.listen(3000, () => console.log(`Server Active: http://localhost:3000`));
