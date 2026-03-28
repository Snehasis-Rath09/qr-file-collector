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

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const banned = ['.exe', '.bat', '.sh', '.cmd', '.msi', '.vbs', '.docm'];
  if (banned.includes(ext)) {
    return cb(new Error("Malicious"), false);
  }
  cb(null, true);
};

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter
});

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
  sessions[id] = { files: [], createdAt: Date.now() };
  
  let uploadUrl;
  const host = req.get('host') || '';
  

  if (host.includes('onrender.com') || host.includes('vercel.app') || host.includes('qr-file-collector') || host.includes('loca.lt') || host.includes('trycloudflare.com')) {
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

app.post("/upload/:id", (req, res) => {
  upload.array("files")(req, res, (err) => {
    if (err) {
      if (err.message === "Malicious") {
        return res.status(400).json({ error: "File type not allowed! (Possible Malware)" });
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File size exceeds 50MB limit!" });
      }
      return res.status(500).json({ error: "Upload failed." });
    }

    const id = req.params.id;
    if (!sessions[id]) sessions[id] = { files: [], createdAt: Date.now() };
    
    if (req.files) {
      req.files.forEach(file => {
        const fileData = {
          url: `/uploads/${file.filename}`,
          name: file.originalname,
          size: file.size,
          uploadedAt: new Date().toLocaleString()
        };
        sessions[id].files.push(fileData);
      });
    }
    
    io.to(id).emit("filesUpdated", { files: sessions[id].files, total: sessions[id].files.length });
    res.json({ success: true });
  });
});

io.on("connection", (socket) => {
  socket.on("join", (id) => {
    socket.join(id);
    if (sessions[id]) {
      socket.emit("filesUpdated", { files: sessions[id].files, total: sessions[id].files.length });
    }
  });
});

// Cron-like TTL Background Worker (runs every hour)
setInterval(() => {
  const now = Date.now();
  const UPLOADS_DIR = path.join(__dirname, 'uploads');
  const MAX_FILE_AGE = 24 * 60 * 60 * 1000; // 24 hours
  const SESSION_MAX_AGE = 12 * 60 * 60 * 1000; // 12 hours

  // 1. Cleanup old UUID memory block sessions
  for (const sessionId in sessions) {
    if (now - sessions[sessionId].createdAt > SESSION_MAX_AGE) {
      delete sessions[sessionId];
    }
  }

  // 2. Erase archaic file storage to conserve VPS SSD
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(UPLOADS_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && (now - stats.mtimeMs > MAX_FILE_AGE)) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 60 * 60 * 1000);


const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 LAN IP: ${getLanIP()}:3000`);
});