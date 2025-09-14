# Dockerfile  – Playwright + Chrome + Node 20
FROM apify/actor-node-playwright-chrome:20

# 1) Copy only package manifests first (for Docker cache)
COPY package*.json ./

# 2) Install production deps
RUN npm install --only=prod --no-optional --quiet

# 3) Copy the rest of the source code
COPY . ./

# 4) Run the crawler (same as "npm start")
CMD ["node", "main.js"]
