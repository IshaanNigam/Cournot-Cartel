# The Cournot Cartel

A real-time multiplayer oligopoly and collusion game built with Node.js, Express, and Socket.io. Designed for Game Theory Society tournaments, players manage rival energy conglomerates competing over five fiscal quarters under stochastic macroeconomic demand shocks and asymmetric tactical operations.

## Core Game Theory Mechanics

* **Linear Inverse Demand Curve:** Each quarter reveals a Demand Shock card defining the market clearing price:
  $$P = \max(P_{\min}, A - k \cdot Q_{\text{total}})$$
  where $Q_{\text{total}} = \sum q_i$ is the aggregate supply across all firms.
* **Convex Marginal Production Costs:** Output capacity cards carry escalating operational costs (1B = 0, 2B = 2, 3B = 5, 4B = 9, 5B = 14 tokens), punishing unhedged overproduction when prices crash.
* **Non-Binding Cartel Summits:** Players negotiate a target production quota each quarter before secretly locking in output cards.
* **Sub-Rosa Tech Cards:** Asymmetric abilities including Strategic Petroleum Reserves (inventory arbitrage), Regulatory Whistleblowers (quota enforcement), State Energy Subsidies (cost shifts), Supply Chain Embargoes (capacity blockades), and Satellite Reconnaissance (Stackelberg information advantage).

## Quick Start (Local & LAN Hotspot)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000` in your browser to host a table or launch the **Projector View**.
4. For in-person society events, connect players to the same Wi-Fi network or mobile hotspot and have them navigate to `http://<your-local-ip>:3000` on their phones.

## Docker Deployment

Build and run the containerized server:

```bash
docker build -t cournot-cartel .
docker run -p 3000:3000 cournot-cartel
```

## Cloud Hosting (Render / Railway)

* **Build Command:** `npm install`
* **Start Command:** `npm start`
* **Port:** Automatically binds to `process.env.PORT` (defaults to 3000).