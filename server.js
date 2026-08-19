const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const app = express();
app.use(express.static(path.join(__dirname, "public")));
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "5mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id BIGSERIAL PRIMARY KEY,
      tax_id VARCHAR(30),
      name TEXT NOT NULL,
      entity_type VARCHAR(50),
      region TEXT,
      district TEXT,
      activity TEXT,
      phone VARCHAR(50),
      registered_at TIMESTAMP,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tax_id, registered_at)
    )
  `);

  await pool.query(`
    DELETE FROM businesses
    WHERE registered_at < NOW() - INTERVAL '30 days'
  `);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "healthy",
      database: "connected"
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      database: "not connected"
    });
  }
});

app.get("/api/businesses", async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM businesses
      WHERE registered_at < NOW() - INTERVAL '30 days'
    `);

    const result = await pool.query(`
      SELECT *
      FROM businesses
      WHERE registered_at >= NOW() - INTERVAL '30 days'
      ORDER BY registered_at DESC
      LIMIT 5000
    `);

    res.json({
      count: result.rows.length,
      businesses: result.rows
    });
  } catch (error) {
    res.status(500).json({
      error: "Database error"
    });
  }
});

app.post("/api/businesses/import", async (req, res) => {
  try {
    const importKey = req.headers["x-import-key"];

    if (
      !process.env.IMPORT_API_KEY ||
      importKey !== process.env.IMPORT_API_KEY
    ) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const businesses = Array.isArray(req.body)
      ? req.body
      : req.body.businesses;

    if (!Array.isArray(businesses)) {
      return res.status(400).json({
        error: "businesses array required"
      });
    }

    let imported = 0;

    for (const business of businesses) {
      if (!business.name || !business.registered_at) continue;

      await pool.query(
        `
        INSERT INTO businesses (
          tax_id,
          name,
          entity_type,
          region,
          district,
          activity,
          phone,
          registered_at,
          source
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (tax_id, registered_at)
        DO UPDATE SET
          name = EXCLUDED.name,
          entity_type = EXCLUDED.entity_type,
          region = EXCLUDED.region,
          district = EXCLUDED.district,
          activity = EXCLUDED.activity,
          phone = EXCLUDED.phone,
          source = EXCLUDED.source
        `,
        [
          business.tax_id || null,
          business.name,
          business.entity_type || null,
          business.region || null,
          business.district || null,
          business.activity || null,
          business.phone || null,
          business.registered_at,
          business.source || null
        ]
      );

      imported++;
    }

    await pool.query(`
      DELETE FROM businesses
      WHERE registered_at < NOW() - INTERVAL '30 days'
    `);

    res.json({
      status: "ok",
      imported
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Import failed"
    });
  }
});

initDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`AI Business Radar running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
