# Wizard Island

A 2-player strategic card game. Explore 8 islands, collect powerful cards, and defeat the Dark Wizard before your opponent does.

---

## Setup

- 8 islands are arranged in a circle around the Dark Wizard's tower.
- One card is dealt face-up to each island at the start of every round.
- A **Game Modifier** card is drawn at the start and may alter rules (e.g. stronger wizard, reduced inventory).
- The Dark Wizard begins on a random island.

---

## Each Round

### 1. Choose a Destination

Both players secretly choose where to go:

- **An island (1–8)** — to collect its card, or battle your opponent for it.
- **The Dark Wizard's Tower** — to attack the Dark Wizard directly.

Choices are hidden. Once both players have chosen, tokens move simultaneously.

---

### 2. Resolve Destinations

#### Land alone on an island
You collect the card. No contest.

#### Land on the same island as your opponent
A **PvP battle** begins. The winner takes the island card.

#### Both go to the Tower
A **cooperate or betray** choice is presented:

| You \ Opponent | Cooperate | Betray |
|---|---|---|
| **Cooperate** | Fight together — combine attack or defence | Opponent sides with the wizard against you |
| **Betray** | You side with the wizard against opponent | You both fight separately — both draw a Dark Wizard spell |

#### One player goes to the Tower
That player fights the Dark Wizard alone.

---

### 3. The Dark Wizard Moves

After all player actions resolve, the Dark Wizard moves to a **random island**.

- If a player is on that island, the wizard **attacks them immediately**.
- This happens every round, regardless of what the players did.

---

### 4. Redeal

If all islands are empty after the round, all cards are reshuffled and redealt to the islands.

---

## Cards

All card types are shuffled into a single deck and dealt to islands.

### Inventory Cards
These are kept in your inventory (max **5 slots**, unless a modifier changes this). Only one card of each type can be held — if you find a better one, you can swap it out.

| Type | Icon | Effect |
|---|---|---|
| **Attack** | ⚔ | Sets your maximum attack die (default: 1) |
| **Defence** | 🛡 | Sets your maximum defence die (default: 1) |
| **Stamina** | ❤ | Sets your maximum attacks per battle (default: 1) |
| **Armour** | 🧥 | Each armour card absorbs **one hit** before you take the penalty |

### Spell Cards
Spells have no inventory limit. Two types:

- **Immediate** — activated automatically when collected.
- **Held** — saved in your spell hand and played whenever you choose.

Held spells appear as buttons at the bottom of the screen. Tap one to read it and decide whether to play it.

---

## Battle

### PvP Battle (player vs player)

1. The player with the higher **Attack** stat goes first. Ties broken by Defence, then Stamina.
2. The attacker rolls up to their **Attack** value. The defender rolls up to their **Defence** value.
3. A hit lands if the **attack roll beats the defence roll**.
4. **First hit wins the island card** (but battle continues until stamina runs out or a player retreats).
5. Each attack uses one point of stamina. When stamina runs out, battle ends.
6. Players alternate attacker/defender each round.

### Wizard Battle (player vs Dark Wizard)

The Dark Wizard's stats: ⚔ **8** · 🛡 **8** · 🧥 **5 Armour** (may be modified).

Each round consists of two phases:
1. **Player attacks** → Wizard defends.
2. **Wizard attacks** → Player defends.

After each round, the **fighting player** can choose to:
- **Continue** into another round (if they still have stamina).
- **Retreat** to any island of their choice.

> Some cards may restrict retreat until stamina is depleted or a set number of rounds are completed.

#### Hitting the Wizard
When the player lands a hit:
- If the wizard still has armour, choose which stat to reduce: **Attack**, **Defence**, or **Armour**.
- If the wizard's armour is already at **0**, the next hit **kills the wizard** — you win the game.

#### Taking a Hit with No Armour
If you are hit and have no armour cards, you must **draw a Dark Wizard spell** — an unpleasant forfeit drawn from a separate deck.

---

## Stats Summary

| Stat | Default | Set by |
|---|---|---|
| Attack | 1 | Attack card in inventory |
| Defence | 1 | Defence card in inventory |
| Stamina | 1 | Stamina card in inventory |
| Armour | 0 | Count of armour cards held |

Higher stat cards replace lower ones (you choose whether to swap if equal).

---

## Winning

**Reduce the Dark Wizard's armour to 0, then land one final hit.**

When his armour hits zero it is flagged — the next successful attack by any player kills him and wins the game.

---

## Dark Wizard Spell Cards

Drawn when:
- You are hit with **no armour**.
- Both players **betray** at the tower (both draw one).

These are forfeits drawn from a separate Dark Wizard spell pool. Both players must acknowledge the card before play continues.

---

## Game Modifier Cards

One modifier is drawn at the start of each game and applies for its duration. Examples:
- **Stronger Wizard** — Dark Wizard starts with boosted stats.
- **Less Inventory** — Maximum inventory reduced below 5.
- Others may alter card draw rules, battle conditions, or wizard behaviour.

---

## Board

| Element | Meaning |
|---|---|
| Coloured card on island | Card type available (⚔🛡❤🧥🔮) |
| Faint card outline | Island is empty |
| 💀 above island | Dark Wizard is currently there |
| Your token (glowing) | Your current position |
| Opponent token | Opponent's current position |
| Ghost token | Your pending destination (before both have chosen) |
