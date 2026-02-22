import express from "express";
import { createServer as createViteServer } from "vite";
import { Octokit } from "octokit";
import cookieParser from "cookie-parser";
import session from "express-session";
import dotenv from "dotenv";

dotenv.config();

// Validate required environment variables
const requiredEnv = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`\x1b[31mCRITICAL ERROR: Missing required environment variables: ${missingEnv.join(', ')}\x1b[0m`);
  console.error('Please check your .env file or environment configuration.');
}

if (!process.env.GEMINI_API_KEY) {
  console.warn('\x1b[33mWARNING: GEMINI_API_KEY is missing. AI documentation features will be disabled.\x1b[0m');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1); // Trust the nginx proxy
  app.use(express.json());
  app.use(cookieParser());
  const isLocal = !process.env.APP_URL?.includes('.run.app');
  
  app.use(session({
    secret: "codespatial-secret",
    resave: true,
    saveUninitialized: true,
    proxy: true, // Required for secure cookies behind a proxy
    name: 'codespatial.sid',
    cookie: {
      // Only force secure/SameSite=None if we are in the AI Studio environment (HTTPS iframe)
      secure: !isLocal,
      sameSite: isLocal ? 'lax' : 'none',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  // Middleware to check for token in header as fallback for cookies
  app.use((req, res, next) => {
    const headerToken = req.headers['x-github-token'];
    // @ts-ignore
    if (headerToken && !req.session.githubToken) {
      // @ts-ignore
      req.session.githubToken = headerToken;
    }
    next();
  });

  // --- GitHub OAuth ---

  app.get("/api/auth/github/url", (req, res) => {
    // Use APP_URL if provided, otherwise fallback to the request's origin
    // This helps when accessing via IP address in a local network
    const host = req.get('host');
    // Default to http for local development, localhost, or IP-based domains
    const isLocal = host?.includes('localhost') || 
                    host?.includes('127.0.0.1') || 
                    host?.match(/^\d+\.\d+\.\d+\.\d+/) ||
                    host?.includes('.nip.io') ||
                    host?.includes('.test');
    
    const detectedProtocol = isLocal ? 'http' : 'https';
    
    const fallbackUrl = `${detectedProtocol}://${host}`;
    const rawAppUrl = process.env.APP_URL || fallbackUrl;
    const appUrl = rawAppUrl.replace(/\/$/, "");
    const redirectUri = `${appUrl}/auth/github/callback`;

    console.log("Generating Auth URL with redirect:", redirectUri);

    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: "repo,read:user",
      state: "random_state"
    });
    res.json({ url: `https://github.com/login/oauth/authorize?${params.toString()}` });
  });

  app.get("/auth/github/callback", async (req, res) => {
    const { code } = req.query;
    console.log("Received GitHub callback with code:", code ? "YES" : "NO");
    
    try {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const data = await response.json();
      console.log("GitHub token response received:", data.access_token ? "SUCCESS" : "FAILED", data.error || "");

      if (data.access_token) {
        // @ts-ignore
        req.session.githubToken = data.access_token;
        // Force session save
        req.session.save((err) => {
          if (err) console.error("Session save error:", err);
          console.log("Session saved with token");
          res.send(`
            <html>
              <body>
                <script>
                  console.log("Sending success message to opener...");
                  if (window.opener) {
                    window.opener.postMessage({ 
                      type: 'OAUTH_AUTH_SUCCESS',
                      token: '${data.access_token}'
                    }, '*');
                    setTimeout(() => window.close(), 100);
                  } else {
                    console.error("No opener found!");
                    window.location.href = '/';
                  }
                </script>
                <p>Authentication successful. Closing window...</p>
              </body>
            </html>
          `);
        });
      } else {
        res.status(400).send("Failed to get access token: " + (data.error_description || data.error));
      }
    } catch (error) {
      console.error("OAuth callback error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  app.get("/api/user", async (req, res) => {
    // @ts-ignore
    const token = req.session.githubToken;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.rest.users.getAuthenticated();
    res.json(data);
  });

  app.get("/api/repos", async (req, res) => {
    // @ts-ignore
    const token = req.session.githubToken;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: 100
    });
    res.json(data);
  });

  app.get("/api/repo/files", async (req, res) => {
    const { owner, repo, branch = "main", path = "" } = req.query;
    // @ts-ignore
    const token = req.session.githubToken;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const octokit = new Octokit({ auth: token });
    
    try {
      console.log(`Fetching files for ${owner}/${repo} at path: "${path}"`);
      
      const { data } = await octokit.rest.repos.getContent({
        owner: owner as string,
        repo: repo as string,
        path: path as string,
        ref: branch as string,
      });

      if (Array.isArray(data)) {
        // Return files and directories in this path
        const items = data.map(item => ({
          name: item.name,
          path: item.path,
          type: item.type, // 'file' or 'dir'
          size: item.size
        }));
        res.json(items);
      } else {
        res.status(400).json({ error: "Not a directory" });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch repo content" });
    }
  });

  app.get("/api/repo/tree", async (req, res) => {
    const { owner, repo, branch = "main" } = req.query;
    // @ts-ignore
    const token = req.session.githubToken;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const octokit = new Octokit({ auth: token });
    
    try {
      // Get the default branch's latest commit SHA
      const { data: refData } = await octokit.rest.git.getRef({
        owner: owner as string,
        repo: repo as string,
        ref: `heads/${branch}`,
      });

      // Get the recursive tree
      const { data: treeData } = await octokit.rest.git.getTree({
        owner: owner as string,
        repo: repo as string,
        tree_sha: refData.object.sha,
        recursive: "true",
      });

      // Just return paths and types to keep payload small
      const items = treeData.tree.map(item => ({
        path: item.path,
        type: item.type, // 'blob' or 'tree'
        size: item.size
      }));

      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch repo tree" });
    }
  });

  app.get("/api/repo/file/content", async (req, res) => {
    const { owner, repo, path } = req.query;
    // @ts-ignore
    const token = req.session.githubToken;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const octokit = new Octokit({ auth: token });

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: owner as string,
        repo: repo as string,
        path: path as string,
      });

      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        res.json({ content });
      } else {
        res.status(400).json({ error: "Not a file" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch file content" });
    }
  });

  app.get("/api/repo/commits", async (req, res) => {
    const { owner, repo, per_page = 30 } = req.query;
    // @ts-ignore
    const token = req.session.githubToken;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const octokit = new Octokit({ auth: token });
    try {
      const { data } = await octokit.rest.repos.listCommits({
        owner: owner as string,
        repo: repo as string,
        per_page: parseInt(per_page as string)
      });
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch commits" });
    }
  });

  app.get("/api/repo/commit", async (req, res) => {
    const { owner, repo, ref } = req.query;
    // @ts-ignore
    const token = req.session.githubToken;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const octokit = new Octokit({ auth: token });
    try {
      const { data } = await octokit.rest.repos.getCommit({
        owner: owner as string,
        repo: repo as string,
        ref: ref as string
      });
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch commit details" });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // --- Vite Middleware ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
