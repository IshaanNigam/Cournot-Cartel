# The Cournot Cartel

A multiplayer oligopoly game I built for Game Theory Society intras. Each player runs an energy company, and over five quarters you're all competing for the same market while trying (and usually failing) to keep a cartel together. It runs on Node.js, Express and Socket.io, so everyone plays live from their own phone or laptop.

## How the game works

**Demand.** Every quarter a Demand Shock card is flipped, and it sets the price curve for that round:

$$P = \max(P_{\min}, A - k \cdot Q_{\text{total}})$$

Here $Q_{\text{total}} = \sum q_i$ is everything all the firms produce combined. **The more the table pumps out, the lower the price.**

**Costs.** Output gets more expensive the more you make. The marginal cost for each output card is 0 for 1B, 2 for 2B, 5 for 3B, 9 for 4B and 14 for 5B tokens. If you overproduce and the price tanks, you eat that cost.

**Cartel talks.** Before each quarter the table agrees on a target quota. Nobody has to stick to it. Everyone then locks in their output cards in secret, and that gap between what you promised and what you do is the whole game.

**Tech cards.** Each player can also hold secret ability cards:

- Strategic Petroleum Reserves (store output and sell it later)
- Regulatory Whistleblowers (enforce the quota against cheaters)
- State Energy Subsidies (shift some of your costs)
- Supply Chain Embargoes (block a rival's capacity)
- Satellite Reconnaissance (see what others are doing first, Stackelberg-style)

## Running it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. You can host a table from there, or open the Projector View to put the game state on a big screen.

For events in person, put everyone on the same Wi-Fi (a phone hotspot works fine) and have players open `http://<your-local-ip>:3000` on their phones.

## Docker

```bash
docker build -t cournot-cartel .
docker run -p 3000:3000 cournot-cartel
```
