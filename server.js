const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({
  destination: "./uploads",
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

let sessions = {};

function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.get("/generate", async (req, res) => {
  const id = uuidv4();
  sessions[id] = [];
  
  let uploadUrl;
  const host = req.get('host') || '';
  

  if (host.includes('onrender.com') || host.includes('vercel.app') || host.includes('qr-file-collector')) {
    uploadUrl = `https://${host}/qr/${id}`;
    isLocal = false;
  } else {

    const lanIP = getLanIP();
    uploadUrl = `http://${lanIP}:3000/qr/${id}`;
    isLocal = true;
  }
  
  const qr = await QRCode.toDataURL(uploadUrl);
  res.json({ id, qr, uploadUrl, isLocal });
});


app.get("/qr/:id", (req, res) => {
  res.redirect(`/upload/${req.params.id}`);
});

app.get("/upload/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "upload.html"));
});

app.post("/upload/:id", upload.single("file"), (req, res) => {
  const id = req.params.id;
  if (!sessions[id]) sessions[id] = [];
  
  const fileData = {
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    uploadedAt: new Date().toLocaleString()
  };
  
  sessions[id].push(fileData);
  io.to(id).emit("filesUpdated", { files: sessions[id], total: sessions[id].length });
  res.json({ success: true });
});

io.on("connection", (socket) => {
  socket.on("join", (id) => {
    socket.join(id);
    if (sessions[id]) {
      socket.emit("filesUpdated", { files: sessions[id], total: sessions[id].length });
    }
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 LAN IP: ${getLanIP()}:3000`);
});