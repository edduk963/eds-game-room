import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { DEFAULT_FORFEIT_LINES } from '../game/beatdealerGame.js';
import { pairBudget as memPairBudget, fitsGrid as memFitsGrid } from '../game/memoryGame.js';

export function renderLobby(root) {
  if (!state.myName) {
    _renderNameEntry(root);
    return;
  }

  let selectedGame = state.devMode ? (state.devPreselect || 'splitloot') : 'galactic';
  let selectedRounds = 3;
  let selectedMode = 'easy';
  let selectedForfeit = 30;
  let selectedEdgeMode = false;
  let selectedEdgeLives = 3;
  let selectedHiloMode = 'submission';
  let selectedHiloCycles = 1;
  let selectedHiloDeckSize = 1;
  let selectedHiloVibeRamp = 10;
  let selectedHiloLives = 3;
  let selectedHiloVibeTarget = 'both';
  let selectedStlDifficulty = 'normal';
  let selectedStlForfeitCards = ['truth', 'dare', 'control', 'strip', 'drink', 'surrender'];
  let selectedBtdForfeits = [...DEFAULT_FORFEIT_LINES];
  let selectedBtdMode = 'draw';
  let selectedBtdGameMode = 'dealer';
  let selectedWiWinCondition = 'normal';
  let selectedWiSpellLimit = 5;
  let selectedDiceVibeRule = 'lowest';
  let selectedLcTimer = false;
  let selectedLcMinutes = 10;
  let selectedLcDeckSize = 2;
  let selectedLcReward = 'full';
  let selectedBsGridSize = 'standard';
  let selectedBsVibeMultiplier = 1.5;
  let selectedUnoRounds = 5;
  let selectedUnoSpecialPacks = [];
  let selectedSnlMode = 'versus';
  let selectedSnlBoardSize = 'standard';
  let selectedSnlDensity = 'even';
  let selectedSnlStakeMix = 'mixed';
  let selectedSnlVibeScale = 'full';
  let selectedSnlWinCondition = 'race';
  let selectedSnlFinalRule = 'exact';
  let selectedSnlPowerups = true;
  let selectedSnlCoopBetray = false;
  let selectedSnlForfeitCards = ['vibe', 'edge', 'task', 'surrender'];
  let selectedSnlForfeitLines = [];
  let selectedSnlAmbient = false;
  let selectedSnlTapOut = false;
  let selectedMemMode = 'versus';
  let selectedMemForfeitLines = [];
  let selectedMemVibeDurations = [];
  let selectedMemGridSize = '6x6';
  let selectedMemFits = true;

  root.innerHTML = `
    <div class="card">
      <h2>Session ${state.sessionId}</h2>
      <p class="subtitle">Share this link with a friend so they can join.</p>
      <div class="share" id="share">${location.origin}/#/session/${state.sessionId}</div>
      <div class="players">
        <div class="player ${state.hostName ? '' : 'empty'}" id="p-host">
          <div class="name">${state.hostName || 'waiting…'}</div>
          <div class="role">Host</div>
        </div>
        <div class="player ${state.guestName ? '' : 'empty'}" id="p-guest">
          <div class="name">${state.guestName || 'waiting for player 2…'}</div>
          <div class="role">Guest</div>
        </div>
        <div class="player ${state.guest2Name ? '' : 'empty'}" id="p-guest2">
          <div class="name">${state.guest2Name || 'player 3 (optional)…'}</div>
          <div class="role">Guest 2</div>
        </div>
      </div>
      <h2>Choose a game</h2>
      <div class="game-list" id="game-list">
        ${state.devMode ? `
        <div class="game-tile game-tile-selectable" data-game="splitloot">
          <div class="name">Split the Loot</div>
          <div class="desc">Two-player vault escape. Collect loot, dodge guards, trigger hidden traps. Escape with enough loot or face the forfeits.</div>
        </div>
        <div class="game-tile game-tile-selectable" data-game="wizardisland">
          <div class="name">Wizard Island</div>
          <div class="desc">Roll dice to explore 8 islands, collect stat cards, cast spells, and battle each other and the Dark Wizard boss.</div>
        </div>
        ` : `
        <div class="game-category-label">Arcade</div>
        <div class="game-category-grid">
          <div class="game-tile game-tile-selectable selected" data-game="galactic">
            <div class="game-tile-icon">🚀</div>
            <div>
              <div class="name">Space Shooter</div>
              <div class="desc">90s. Shoot invaders, dodge debris. Vibe on hits, win with score.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="endurance">
            <div class="game-tile-icon">🛸</div>
            <div>
              <div class="name-row"><span class="name">Endurance</span><span class="vibe-badge">Vibe</span></div>
              <div class="desc">Rapid fire stacks recoil vibe. Aliens reaching your line hit full intensity.</div>
            </div>
          </div>
        </div>
        <div class="game-category-label">Card Games</div>
        <div class="game-category-grid">
          <div class="game-tile game-tile-selectable" data-game="hilo">
            <div class="game-tile-icon">🃏</div>
            <div>
              <div class="name-row"><span class="name">Hi-Lo</span><span class="vibe-badge">Vibe</span><span class="badge-1p">1P</span><span class="badge-3p">3P</span></div>
              <div class="desc">Guess higher or lower. Correct guesses vibe your opponent — intensity builds each card. Solo: vibe yourself.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="beatdealer">
            <div class="game-tile-icon">🎴</div>
            <div>
              <div class="name-row"><span class="name">Beat the Dealer</span><span class="badge-1p">1P</span><span class="badge-3p">3P</span></div>
              <div class="desc">Beat the computer dealer. Lose a hand and face the forfeit. 10 rounds. Playable solo.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="mastermind">
            <div class="game-tile-icon">🔐</div>
            <div>
              <div class="name-row"><span class="name">Mastermind</span><span class="badge-1p">1P</span><span class="badge-3p">3P</span></div>
              <div class="desc">Crack the colour code before your opponent. Each close guess vibrates them.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="dice">
            <div class="game-tile-icon">🎲</div>
            <div>
              <div class="name-row"><span class="name">Dice</span><span class="badge-3p">3P</span></div>
              <div class="desc">Roll each round. Loser suffers escalating forfeit — starts 15s and doubles on each loss.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="lastcall">
            <div class="game-tile-icon">🏁</div>
            <div>
              <div class="name-row"><span class="name">Last Call</span><span class="vibe-badge">Vibe</span><span class="badge-1p">1P</span><span class="badge-3p">3P</span></div>
              <div class="desc">Win vibe time off Hi-Lo, then run it on yourself. Race to finish before the clock — whoever doesn't, forfeits.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="uno">
            <div class="game-tile-icon">🎴</div>
            <div>
              <div class="name-row"><span class="name">UNO</span><span class="vibe-badge">Vibe</span><span class="badge-3p">3P</span></div>
              <div class="desc">Classic UNO — match colors and numbers. Draw 2 and Draw 4 buzz your opponent. Loser forfeits.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="memory">
            <div class="game-tile-icon">🧠</div>
            <div>
              <div class="name-row"><span class="name">Memory Match</span><span class="vibe-badge">Vibe</span><span class="badge-1p">1P</span><span class="badge-3p">3P</span></div>
              <div class="desc">Flip pairs on a custom grid. Mismatches bank your own forfeits and vibe charges — anyone can trigger a rival's vibe stash any time. Find both win cards to take it all.</div>
            </div>
          </div>
        </div>
        <div class="game-category-label">Strategy</div>
        <div class="game-category-grid">
          <div class="game-tile game-tile-selectable" data-game="battleships">
            <div class="game-tile-icon">🚢</div>
            <div>
              <div class="name">Battleships</div>
              <div class="desc">Place your fleet, sink theirs. Each hit deals 15s — stack them up. Winner takes control of the loser's vibe.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="standoff">
            <div class="game-tile-icon">⚔️</div>
            <div>
              <div class="name">Standoff</div>
              <div class="desc">Secretly distribute tokens across 5 battlefields. Reveal simultaneously. Outthink — every loss is felt.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="tugofwar">
            <div class="game-tile-icon">💪</div>
            <div>
              <div class="name-row"><span class="name">Tug of War</span><span class="vibe-badge">Vibe</span></div>
              <div class="desc">Both vibe continuously. The losing player feels it more. Pool escalates every 10s.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="wizardisland">
            <div class="game-tile-icon">🏝</div>
            <div>
              <div class="name">Wizard Island</div>
              <div class="desc">Explore 8 islands, collect stat cards and spells, battle each other and the Dark Wizard. Reduce his armour to zero to win.</div>
            </div>
          </div>
          <div class="game-tile game-tile-selectable" data-game="snakes">
            <div class="game-tile-icon">🐍</div>
            <div>
              <div class="name-row"><span class="name">Vipers &amp; Vines</span><span class="vibe-badge">Vibe</span><span class="badge-1p">1P</span><span class="badge-3p">3P</span></div>
              <div class="desc">Race up the board. Climb a ladder and punish your opponent. Land on a snake and pay — stakes scale with height.</div>
            </div>
          </div>
        </div>
        `}
      </div>
      <div id="hilo-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Mode:</span>
          <div class="mm-rounds-btns" id="hilo-mode-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-mode="submission">Submission</button>
            <button class="mm-rounds-btn ghost" data-hilo-mode="fixed">Escape</button>
            <button class="mm-rounds-btn ghost" data-hilo-mode="random">Random</button>
          </div>
        </div>
        <div id="hilo-cycles-row" class="mm-rounds-row" style="margin-top:4px;display:none;">
          <span>Rounds:</span>
          <div class="mm-rounds-btns" id="hilo-cycles-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-cycles="1">1</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="2">2</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="3">3</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="4">4</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="5">5</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="6">6</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="0">Random</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Deck size:</span>
          <div class="mm-rounds-btns" id="hilo-deck-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-deck="1">1</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="2">2</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="3">3</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="4">4</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="5">5</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="6">6</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="0">Random</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Vibe ramp:</span>
          <div class="mm-rounds-btns" id="hilo-ramp-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-ramp="10">10%</button>
            <button class="mm-rounds-btn ghost" data-hilo-ramp="15">15%</button>
            <button class="mm-rounds-btn ghost" data-hilo-ramp="20">20%</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Lives:</span>
          <div class="mm-rounds-btns" id="hilo-lives-btns">
            <button class="mm-rounds-btn ghost" data-hilo-lives="1">1</button>
            <button class="mm-rounds-btn ghost" data-hilo-lives="2">2</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-lives="3">3</button>
            <button class="mm-rounds-btn ghost" data-hilo-lives="5">5</button>
            <button class="mm-rounds-btn ghost" data-hilo-lives="10">10</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Vibe target <span style="font-size:11px;color:var(--muted)">(3-player)</span>:</span>
          <div class="mm-rounds-btns" id="hilo-vibe-target-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-vibe-target="both">Both vibers</button>
            <button class="mm-rounds-btn ghost" data-hilo-vibe-target="highest_lives">Highest lives</button>
            <button class="mm-rounds-btn ghost" data-hilo-vibe-target="random">Random</button>
          </div>
        </div>
      </div>
      <div id="stl-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Difficulty:</span>
          <div class="mm-rounds-btns" id="stl-diff-btns">
            <button class="mm-rounds-btn ghost" data-stl-diff="easy">Easy</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-stl-diff="normal">Normal</button>
            <button class="mm-rounds-btn ghost" data-stl-diff="hard">Hard</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:8px;flex-wrap:wrap;gap:6px;">
          <span style="width:100%">Forfeit cards:</span>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="truth">Truth</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="dare">Dare</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="drink">Drink</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="strip">Strip</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="control">Control</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="surrender">Surrender</button>
        </div>
      </div>
      <div id="uno-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Rounds:</span>
          <div class="mm-rounds-btns" id="uno-rounds-btns">
            <button class="mm-rounds-btn ghost" data-uno-rounds="1">1</button>
            <button class="mm-rounds-btn ghost" data-uno-rounds="3">3</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-uno-rounds="5">5</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="flex-direction:column;align-items:stretch;gap:6px;">
          <span>Special card packs <span style="font-size:11px;color:var(--muted)">(tap to toggle)</span>:</span>
          <div class="uno-packs-grid" id="uno-packs-grid">
            <button class="uno-pack-btn ghost" data-uno-pack="plus10">+10 Pickup<br><span class="uno-pack-desc">Like Wild +4 but draws 10</span></button>
            <button class="uno-pack-btn ghost" data-uno-pack="edge">+1 Edge<br><span class="uno-pack-desc">Per colour · stackable on draws</span></button>
            <button class="uno-pack-btn ghost" data-uno-pack="skipall">Skip All<br><span class="uno-pack-desc">Wild · all opponents skipped</span></button>
            <button class="uno-pack-btn ghost" data-uno-pack="swaphands">Swap Hands<br><span class="uno-pack-desc">Wild · swap hand with a player</span></button>
            <button class="uno-pack-btn ghost" data-uno-pack="doubledown">Double Down<br><span class="uno-pack-desc">Wild · doubles pending draw (min ×2)</span></button>
            <button class="uno-pack-btn ghost" data-uno-pack="ctrl2">2 Min Ctrl<br><span class="uno-pack-desc">Wild · winner controls loser's vibe for 2 min</span></button>
          </div>
        </div>
      </div>
      <div id="mm-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Rounds:</span>
          <div class="mm-rounds-btns" id="rounds-btns">
            <button class="mm-rounds-btn ghost" data-rounds="2">2</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-rounds="3">3</button>
            <button class="mm-rounds-btn ghost" data-rounds="4">4</button>
            <button class="mm-rounds-btn ghost" data-rounds="5">5</button>
          </div>
        </div>
        <div class="mm-rounds-row">
          <span>Mode:</span>
          <div class="mm-rounds-btns" id="mode-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-mode="easy" title="Dots appear in slot order — you can see exactly which positions are correct">Easy</button>
            <button class="mm-rounds-btn ghost" data-mode="hard" title="Dots are only a count — no positions revealed">Hard</button>
          </div>
        </div>
      </div>
      <div id="btd-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Game mode:</span>
          <div class="mm-rounds-btns" id="btd-gamemode-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-btd-gamemode="dealer" title="Players race a dealer card — anyone who doesn't beat the dealer suffers">Vs Dealer</button>
            <button class="mm-rounds-btn ghost" data-btd-gamemode="h2h" title="No dealer — players lay a card, highest wins, everyone below the top suffers">Head to Head</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.55;margin:-2px 0 8px;">
          <strong>Vs Dealer</strong> — every player lays a card against one dealer card; anyone who doesn't beat it takes the forfeit.
          <strong>Head to Head</strong> — no dealer; highest card laid is safe (ties at the top are all safe), everyone below takes the forfeit. Works for 2 or 3 players.
        </div>
        <div class="mm-rounds-row">
          <span>Forfeit mode:</span>
          <div class="mm-rounds-btns" id="btd-mode-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-btd-mode="draw" title="The forfeit stays hidden until someone loses, then it's drawn">Draw</button>
            <button class="mm-rounds-btn ghost" data-btd-mode="reveal" title="The round's forfeit is shown before you play your card">Reveal</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.55;margin:-2px 0 8px;">
          <strong>Draw</strong> — the forfeit is hidden until someone loses the round, then drawn from the deck.
          <strong>Reveal</strong> — the round's forfeit is shown up front, so you know the stakes before playing.
        </div>
        <div class="mm-rounds-row" style="flex-direction:column;align-items:stretch;gap:6px;">
          <span>Forfeits <span style="font-size:11px;color:var(--muted)">(agree these together before starting)</span>:</span>
          <div style="font-size:12px;color:var(--muted);line-height:1.55;">
            This box is <strong>pre-filled with the built-in forfeits</strong> — edit, add or remove lines as you both agree, or paste your own. <strong>One forfeit per line.</strong>
            Optionally start a line with <code>[1]</code>, <code>[2]</code> or <code>[3]</code> to set how hard it is to beat:
            <code>[1]</code> easy (dealer plays a low card), <code>[2]</code> medium, <code>[3]</code> hard (dealer plays a high card).
            Clear the box to fall back to the built-in list. Vibe forfeits are always mixed in.
          </div>
          <textarea id="btd-forfeits-input" rows="6"
            placeholder="[1] Take a sip of your drink&#10;[2] Truth or dare — opponent chooses&#10;[3] Loser gives a 2-minute massage"
            style="width:100%;box-sizing:border-box;resize:vertical;font-size:13px;line-height:1.5;padding:8px 10px;border-radius:8px;border:1px solid #2a3556;background:#0f1626;color:var(--ink);font-family:inherit;"></textarea>
          <div id="btd-forfeits-count" style="font-size:11px;color:var(--muted);text-align:right;"></div>
        </div>
      </div>
      <div id="dice-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Who suffers <span style="font-size:11px;color:var(--muted)">(3-player)</span>:</span>
          <div class="mm-rounds-btns" id="dice-rule-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-dice-rule="lowest" title="Each round only the lowest roller suffers (ties for lowest all suffer)">Lowest roller</button>
            <button class="mm-rounds-btn ghost" data-dice-rule="all_but_winner" title="Everyone except the highest roller suffers">All but winner</button>
          </div>
        </div>
      </div>
      <div id="lc-config" style="display:none">
        <div style="font-size:12px;color:var(--muted);line-height:1.55;margin-bottom:10px;">
          Win Hi-Lo guesses to build vibe time — <strong>harder cards (middle values) pay more</strong>. <strong>Bank</strong> to stash it safe (ends your turn), then <strong>claim</strong> it to run the vibes or <strong>play on</strong>. Miss and your unbanked time is gone. Claiming buzzes <strong>both</strong> devices, draining each player's own banked time while you control one shared intensity slider. <strong>Finish before the buzzer</strong> or forfeit. Power-ups are dealt from the deck.
        </div>
        <div class="mm-rounds-row">
          <span>Deadline:</span>
          <div class="mm-rounds-btns" id="lc-timer-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-lc-timer="off" title="No clock — play until everyone presses Finish">No timer</button>
            <button class="mm-rounds-btn ghost" data-lc-timer="on" title="Shared countdown — whoever hasn't finished at 0:00 forfeits">Timer</button>
          </div>
        </div>
        <div id="lc-minutes-row" class="mm-rounds-row" style="margin-top:4px;display:none;">
          <span>Clock:</span>
          <div class="mm-rounds-btns" id="lc-minutes-btns">
            <button class="mm-rounds-btn ghost" data-lc-minutes="5">5m</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-lc-minutes="10">10m</button>
            <button class="mm-rounds-btn ghost" data-lc-minutes="15">15m</button>
            <button class="mm-rounds-btn ghost" data-lc-minutes="20">20m</button>
            <button class="mm-rounds-btn ghost" data-lc-minutes="30">30m</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Deck size:</span>
          <div class="mm-rounds-btns" id="lc-deck-btns">
            <button class="mm-rounds-btn ghost" data-lc-deck="1">1</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-lc-deck="2">2</button>
            <button class="mm-rounds-btn ghost" data-lc-deck="3">3</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Time scaling:</span>
          <div class="mm-rounds-btns" id="lc-reward-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-lc-reward="full" title="Hard (middle) cards pay 10s, easy cards 2s">Full (2–10s)</button>
            <button class="mm-rounds-btn ghost" data-lc-reward="half" title="Everything worth half — slower build, encourages banking">Half (1–5s)</button>
          </div>
        </div>
      </div>
      <div id="wi-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Win condition:</span>
          <div class="mm-rounds-btns" id="wi-win-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-wi-win="normal">Normal</button>
            <button class="mm-rounds-btn ghost" data-wi-win="endurance">Endurance</button>
            <button class="mm-rounds-btn ghost" data-wi-win="timed">Timed</button>
          </div>
        </div>
        <div id="wi-limit-row" class="mm-rounds-row" style="margin-top:4px;display:none;">
          <span>Forfeit limit:</span>
          <div class="mm-rounds-btns" id="wi-limit-btns">
            <button class="mm-rounds-btn ghost" data-wi-limit="3">3</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-wi-limit="5">5</button>
            <button class="mm-rounds-btn ghost" data-wi-limit="8">8</button>
            <button class="mm-rounds-btn ghost" data-wi-limit="10">10</button>
          </div>
        </div>
      </div>
      <div id="bs-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Grid size:</span>
          <div class="mm-rounds-btns" id="bs-grid-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-bs-grid="standard">Standard (10×10)</button>
            <button class="mm-rounds-btn ghost" data-bs-grid="large">Large (14×14)</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Miss vibe:</span>
          <div class="mm-rounds-btns" id="bs-vibe-mult-btns">
            <button class="mm-rounds-btn ghost" data-bs-mult="1">Off</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-bs-mult="1.5">Low</button>
            <button class="mm-rounds-btn ghost" data-bs-mult="2">Medium</button>
            <button class="mm-rounds-btn ghost" data-bs-mult="3">High</button>
          </div>
        </div>
      </div>
      <div id="memory-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Mode:</span>
          <div class="mm-rounds-btns" id="mem-mode-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-mem-mode="versus" title="2-3 players take turns flipping cards, competing to find the win pair">Versus</button>
            <button class="mm-rounds-btn ghost" data-mem-mode="solo" title="Play alone — vibe charges you collect fire automatically without pausing play">Solo</button>
            <button class="mm-rounds-btn ghost" data-mem-mode="watched" title="Play alone while a second connected player watches and controls your vibe charges">Solo + Watcher</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.55;margin:-2px 0 8px;" id="mem-mode-desc"></div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Grid size:</span>
          <div class="mm-rounds-btns" id="mem-grid-btns">
            <button class="mm-rounds-btn ghost" data-mem-grid="4x4">4×4</button>
            <button class="mm-rounds-btn ghost" data-mem-grid="5x5">5×5</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-mem-grid="6x6">6×6</button>
            <button class="mm-rounds-btn ghost" data-mem-grid="8x8">8×8</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:8px;">
          <span>Forfeits <span style="font-size:11px;color:var(--muted)">(one per line — each becomes a matching pair on the board)</span>:</span>
          <textarea id="mem-forfeits-input" rows="5"
            placeholder="Take a shot&#10;20 push-ups&#10;Truth or dare"
            style="width:100%;box-sizing:border-box;resize:vertical;font-size:13px;line-height:1.5;padding:8px 10px;border-radius:8px;border:1px solid #2a3556;background:#0f1626;color:var(--ink);font-family:inherit;"></textarea>
        </div>
        <div id="mem-vibe-durations-row" class="mm-rounds-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:8px;">
          <span>Vibe durations in seconds <span style="font-size:11px;color:var(--muted)">(one per line — each becomes a matching pair. Leave empty for no vibe cards)</span>:</span>
          <textarea id="mem-vibe-durations-input" rows="4"
            placeholder="15&#10;30&#10;60"
            style="width:100%;box-sizing:border-box;resize:vertical;font-size:13px;line-height:1.5;padding:8px 10px;border-radius:8px;border:1px solid #2a3556;background:#0f1626;color:var(--ink);font-family:inherit;"></textarea>
        </div>
        <div id="mem-budget-msg" style="font-size:12px;margin-top:6px;"></div>
      </div>
      <div id="snl-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Players:</span>
          <div class="mm-rounds-btns" id="snl-mode-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-mode="versus">Versus (2–3P)</button>
            <button class="mm-rounds-btn ghost" data-snl-mode="solo">Solo</button>
            <button class="mm-rounds-btn ghost" data-snl-mode="watched">Watched</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Board size:</span>
          <div class="mm-rounds-btns" id="snl-board-btns">
            <button class="mm-rounds-btn ghost" data-snl-board="short">Short (60)</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-board="standard">Standard (100)</button>
            <button class="mm-rounds-btn ghost" data-snl-board="long">Long (150)</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Density:</span>
          <div class="mm-rounds-btns" id="snl-density-btns">
            <button class="mm-rounds-btn ghost" data-snl-density="tame">Tame</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-density="even">Even</button>
            <button class="mm-rounds-btn ghost" data-snl-density="brutal">Brutal</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Stakes:</span>
          <div class="mm-rounds-btns" id="snl-stake-btns">
            <button class="mm-rounds-btn ghost" data-snl-stake="vibe">Vibe only</button>
            <button class="mm-rounds-btn ghost" data-snl-stake="forfeits">Forfeits only</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-stake="mixed">Mixed</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Win condition:</span>
          <div class="mm-rounds-btns" id="snl-win-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-win="race">Race</button>
            <button class="mm-rounds-btn ghost" data-snl-win="endurance">Endurance</button>
          </div>
        </div>
        <div id="snl-finalrule-row" class="mm-rounds-row" style="margin-top:4px;">
          <span>Final tile:</span>
          <div class="mm-rounds-btns" id="snl-finalrule-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-final="exact">Exact</button>
            <button class="mm-rounds-btn ghost" data-snl-final="pass">Pass</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Powerups:</span>
          <div class="mm-rounds-btns" id="snl-powerups-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-powerups="on">On</button>
            <button class="mm-rounds-btn ghost" data-snl-powerups="off">Off</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;" id="snl-fork-row">
          <span>Fork tiles:</span>
          <div class="mm-rounds-btns" id="snl-fork-btns">
            <button class="mm-rounds-btn ghost" data-snl-fork="on">On</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-fork="off">Off</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:8px;flex-wrap:wrap;gap:6px;" id="snl-cards-row">
          <span style="width:100%">Forfeit cards:</span>
          <button class="mm-rounds-btn mm-rounds-selected" data-snl-card="vibe">⚡ Vibe</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-snl-card="edge">🌀 Edge</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-snl-card="task">🪢 Task</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-snl-card="surrender">🏳 Surrender</button>
        </div>
        <div class="mm-rounds-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:8px;">
          <span>Custom forfeits <span style="font-size:11px;color:var(--muted)">(one per line — if any are entered they replace the categories above entirely; prefix with [1], [2], or [3] to set severity tier, default tier 1)</span>:</span>
          <textarea id="snl-forfeits-input" rows="5"
            placeholder="[1] 10 push-ups&#10;[2] Wear the vibe for 1 minute&#10;[3] Lose an item of clothing"
            style="width:100%;box-sizing:border-box;resize:vertical;font-size:13px;line-height:1.5;padding:8px 10px;border-radius:8px;border:1px solid #2a3556;background:#0f1626;color:var(--ink);font-family:inherit;"></textarea>
        </div>
        <div id="snl-ambient-row" class="mm-rounds-row" style="margin-top:4px;display:none;">
          <span>Ambient vibe:</span>
          <div class="mm-rounds-btns" id="snl-ambient-btns">
            <button class="mm-rounds-btn ghost" data-snl-ambient="on">On</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-ambient="off">Off</button>
          </div>
        </div>
        <div id="snl-tapout-row" class="mm-rounds-row" style="margin-top:4px;display:none;">
          <span>Tap-out:</span>
          <div class="mm-rounds-btns" id="snl-tapout-btns">
            <button class="mm-rounds-btn ghost" data-snl-tapout="on">On</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-snl-tapout="off">Off</button>
          </div>
        </div>
      </div>
      <div id="forfeit-row" class="mm-rounds-row" style="margin-top:16px;">
        <span>Forfeit vibe:</span>
        <div class="mm-rounds-btns" id="forfeit-btns">
          <button class="mm-rounds-btn ghost" data-forfeit="15">15s</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-forfeit="30">30s</button>
          <button class="mm-rounds-btn ghost" data-forfeit="60">60s</button>
          <button class="mm-rounds-btn ghost" data-forfeit="120">2min</button>
          <button class="mm-rounds-btn ghost" data-forfeit="300">5min</button>
          <button class="mm-rounds-btn ghost" data-forfeit="600">10min</button>
        </div>
      </div>
      <div id="edge-mode-row" class="mm-rounds-row" style="margin-top:16px;">
        <span>Edge mode:</span>
        <div class="mm-rounds-btns" id="edge-btns">
          <button class="mm-rounds-btn mm-rounds-selected" data-edge="off">Off</button>
          <button class="mm-rounds-btn ghost" data-edge="on">On</button>
        </div>
      </div>
      <div id="edge-lives-row" class="mm-rounds-row" style="display:none;margin-top:8px;">
        <span>Lives (E key):</span>
        <div class="mm-rounds-btns" id="edge-lives-btns">
          <button class="mm-rounds-btn ghost" data-lives="1">1</button>
          <button class="mm-rounds-btn ghost" data-lives="2">2</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-lives="3">3</button>
          <button class="mm-rounds-btn ghost" data-lives="5">5</button>
          <button class="mm-rounds-btn ghost" data-lives="10">10</button>
        </div>
      </div>
      <div class="actions">
        <button class="ghost" id="copy">Copy link</button>
        <button class="ghost" id="leave">Leave</button>
        <button id="start" disabled>Start</button>
      </div>
      <div class="vibe-row" style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button id="btn-vibe-bt">Connect via Bluetooth</button>
        <button class="ghost" id="btn-vibe-intiface">Connect via Intiface</button>
        <span id="vibe-hint" style="font-size:12px;color:#888;">Bluetooth: Chrome/Edge only &nbsp;·&nbsp; Intiface: requires Intiface Central running locally</span>
      </div>
      <div style="margin-top:8px;">
        <button class="ghost" id="btn-test-vibe" style="font-size:13px;padding:8px 14px;">Test Vibe</button>
      </div>
      <div id="err" style="margin-top:8px;"></div>
    </div>
  `;

  const startBtn = root.querySelector('#start');
  const errEl = root.querySelector('#err');
  const gameList = root.querySelector('#game-list');
  const unoConfig = root.querySelector('#uno-config');
  const unoRoundsBtns = root.querySelector('#uno-rounds-btns');
  const unoPacksGrid = root.querySelector('#uno-packs-grid');
  const mmConfig = root.querySelector('#mm-config');
  const hiloConfig = root.querySelector('#hilo-config');
  const stlConfig = root.querySelector('#stl-config');
  const roundsBtns = root.querySelector('#rounds-btns');
  const modeBtns = root.querySelector('#mode-btns');
  const forfeitRow = root.querySelector('#forfeit-row');
  const edgeModeRow = root.querySelector('#edge-mode-row');
  const forfeitBtns = root.querySelector('#forfeit-btns');
  const edgeBtns = root.querySelector('#edge-btns');
  const edgeLivesBtns = root.querySelector('#edge-lives-btns');
  const edgeLivesRow = root.querySelector('#edge-lives-row');
  const hiloModeBtns = root.querySelector('#hilo-mode-btns');
  const hiloCyclesBtns = root.querySelector('#hilo-cycles-btns');
  const hiloCyclesRow = root.querySelector('#hilo-cycles-row');
  const hiloDeckBtns = root.querySelector('#hilo-deck-btns');
  const hiloRampBtns = root.querySelector('#hilo-ramp-btns');
  const hiloLivesBtns = root.querySelector('#hilo-lives-btns');
  const wiConfig = root.querySelector('#wi-config');
  const wiWinBtns = root.querySelector('#wi-win-btns');
  const wiLimitRow = root.querySelector('#wi-limit-row');
  const wiLimitBtns = root.querySelector('#wi-limit-btns');
  const btdConfig = root.querySelector('#btd-config');
  const btdModeBtns = root.querySelector('#btd-mode-btns');
  const btdGamemodeBtns = root.querySelector('#btd-gamemode-btns');
  const btdForfeitsInput = root.querySelector('#btd-forfeits-input');
  const btdForfeitsCount = root.querySelector('#btd-forfeits-count');
  const lcConfig = root.querySelector('#lc-config');
  const lcTimerBtns = root.querySelector('#lc-timer-btns');
  const lcMinutesRow = root.querySelector('#lc-minutes-row');
  const lcMinutesBtns = root.querySelector('#lc-minutes-btns');
  const lcDeckBtns = root.querySelector('#lc-deck-btns');
  const lcRewardBtns = root.querySelector('#lc-reward-btns');
  const diceConfig = root.querySelector('#dice-config');
  const diceRuleBtns = root.querySelector('#dice-rule-btns');
  const bsConfig = root.querySelector('#bs-config');
  const bsGridBtns = root.querySelector('#bs-grid-btns');
  const bsVibeBtns = root.querySelector('#bs-vibe-mult-btns');
  const snlConfig = root.querySelector('#snl-config');
  const snlModeBtns = root.querySelector('#snl-mode-btns');
  const snlBoardBtns = root.querySelector('#snl-board-btns');
  const snlDensityBtns = root.querySelector('#snl-density-btns');
  const snlStakeBtns = root.querySelector('#snl-stake-btns');
  const snlWinBtns = root.querySelector('#snl-win-btns');
  const snlFinalRuleRow = root.querySelector('#snl-finalrule-row');
  const snlFinalRuleBtns = root.querySelector('#snl-finalrule-btns');
  const snlPowerupsBtns = root.querySelector('#snl-powerups-btns');
  const snlForkRow = root.querySelector('#snl-fork-row');
  const snlForkBtns = root.querySelector('#snl-fork-btns');
  const snlCardsRow = root.querySelector('#snl-cards-row');
  const snlForfeitsInput = root.querySelector('#snl-forfeits-input');
  const snlAmbientRow = root.querySelector('#snl-ambient-row');
  const snlAmbientBtns = root.querySelector('#snl-ambient-btns');
  const snlTapOutRow = root.querySelector('#snl-tapout-row');
  const snlTapOutBtns = root.querySelector('#snl-tapout-btns');
  const memConfig = root.querySelector('#memory-config');
  const memModeBtns = root.querySelector('#mem-mode-btns');
  const memModeDesc = root.querySelector('#mem-mode-desc');
  const memGridBtns = root.querySelector('#mem-grid-btns');
  const memForfeitsInput = root.querySelector('#mem-forfeits-input');
  const memVibeDurationsRow = root.querySelector('#mem-vibe-durations-row');
  const memVibeDurationsInput = root.querySelector('#mem-vibe-durations-input');
  const memBudgetMsg = root.querySelector('#mem-budget-msg');

  const MEM_MODE_DESC = {
    versus: 'Everyone takes turns. Mismatches bank forfeits/vibe to your own pile — any other player can trigger your vibe charges at any time.',
    solo: 'Just you. Vibe charges you collect fire automatically as soon as you bank them, at a comfortable default intensity — play keeps going, pause it any time from the vibe bar.',
    watched: 'You play alone, but a second connected player sees the board and manually controls your vibe charges — pattern, intensity, and timing are up to them.',
  };

  function updateMemBudget() {
    const vibeDurations = selectedMemVibeDurations;
    selectedMemFits = memFitsGrid({ forfeitLines: selectedMemForfeitLines, vibeDurations, gridSize: selectedMemGridSize });
    const budget = memPairBudget(selectedMemGridSize);
    const needed = selectedMemForfeitLines.length + vibeDurations.length + 1;
    memBudgetMsg.textContent = selectedMemFits
      ? `${needed} of ${budget} pairs used.`
      : `Too many cards for this grid — ${needed} pairs needed but only ${budget} fit. Trim a list or pick a bigger grid.`;
    memBudgetMsg.style.color = selectedMemFits ? 'var(--muted)' : '#e05252';
  }

  function paintOptions() {
    btdConfig.style.display = selectedGame === 'beatdealer' ? 'block' : 'none';
    btdModeBtns.querySelectorAll('[data-btd-mode]').forEach(b => {
      const sel = b.dataset.btdMode === selectedBtdMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
      b.disabled = state.role !== 'host';
    });
    btdGamemodeBtns.querySelectorAll('[data-btd-gamemode]').forEach(b => {
      const sel = b.dataset.btdGamemode === selectedBtdGameMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
      b.disabled = state.role !== 'host';
    });
    btdForfeitsInput.disabled = state.role !== 'host';
    // Don't clobber the host's caret while they're typing.
    if (document.activeElement !== btdForfeitsInput) {
      btdForfeitsInput.value = selectedBtdForfeits.join('\n');
    }
    btdForfeitsCount.textContent = selectedBtdForfeits.length
      ? `${selectedBtdForfeits.length} forfeit${selectedBtdForfeits.length === 1 ? '' : 's'} in the deck`
      : 'Empty — using built-in forfeits';
    root.querySelectorAll('.game-tile-selectable').forEach(t =>
      t.classList.toggle('selected', t.dataset.game === selectedGame)
    );
    mmConfig.style.display = selectedGame === 'mastermind' ? 'block' : 'none';
    diceConfig.style.display = selectedGame === 'dice' ? 'block' : 'none';
    bsConfig.style.display = selectedGame === 'battleships' ? 'block' : 'none';
    bsGridBtns.querySelectorAll('[data-bs-grid]').forEach(b => {
      const sel = b.dataset.bsGrid === selectedBsGridSize;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
      b.disabled = state.role !== 'host';
    });
    bsVibeBtns.querySelectorAll('[data-bs-mult]').forEach(b => {
      const sel = parseFloat(b.dataset.bsMult) === selectedBsVibeMultiplier;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
      b.disabled = state.role !== 'host';
    });
    diceRuleBtns.querySelectorAll('[data-dice-rule]').forEach(b => {
      const sel = b.dataset.diceRule === selectedDiceVibeRule;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    lcConfig.style.display = selectedGame === 'lastcall' ? 'block' : 'none';
    lcMinutesRow.style.display = selectedLcTimer ? 'flex' : 'none';
    lcTimerBtns.querySelectorAll('[data-lc-timer]').forEach(b => {
      const sel = (b.dataset.lcTimer === 'on') === selectedLcTimer;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    lcMinutesBtns.querySelectorAll('[data-lc-minutes]').forEach(b => {
      const sel = parseInt(b.dataset.lcMinutes, 10) === selectedLcMinutes;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    lcDeckBtns.querySelectorAll('[data-lc-deck]').forEach(b => {
      const sel = parseInt(b.dataset.lcDeck, 10) === selectedLcDeckSize;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    lcRewardBtns.querySelectorAll('[data-lc-reward]').forEach(b => {
      const sel = b.dataset.lcReward === selectedLcReward;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloConfig.style.display = selectedGame === 'hilo' ? 'block' : 'none';
    stlConfig.style.display = selectedGame === 'splitloot' ? 'block' : 'none';
    wiConfig.style.display = selectedGame === 'wizardisland' ? 'block' : 'none';
    wiWinBtns.querySelectorAll('[data-wi-win]').forEach(b => {
      const sel = b.dataset.wiWin === selectedWiWinCondition;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    wiLimitRow.style.display = selectedWiWinCondition === 'endurance' ? 'flex' : 'none';
    wiLimitBtns.querySelectorAll('[data-wi-limit]').forEach(b => {
      const sel = parseInt(b.dataset.wiLimit, 10) === selectedWiSpellLimit;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    stlConfig.querySelectorAll('[data-stl-diff]').forEach(b => {
      const sel = b.dataset.stlDiff === selectedStlDifficulty;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    stlConfig.querySelectorAll('[data-stl-card]').forEach(b => {
      const sel = selectedStlForfeitCards.includes(b.dataset.stlCard);
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloCyclesRow.style.display = selectedHiloMode === 'fixed' ? 'flex' : 'none';
    hiloModeBtns.querySelectorAll('[data-hilo-mode]').forEach(b => {
      const sel = b.dataset.hiloMode === selectedHiloMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloCyclesBtns.querySelectorAll('[data-hilo-cycles]').forEach(b => {
      const sel = parseInt(b.dataset.hiloCycles, 10) === selectedHiloCycles;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloDeckBtns.querySelectorAll('[data-hilo-deck]').forEach(b => {
      const sel = parseInt(b.dataset.hiloDeck, 10) === selectedHiloDeckSize;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloRampBtns.querySelectorAll('[data-hilo-ramp]').forEach(b => {
      const sel = parseInt(b.dataset.hiloRamp, 10) === selectedHiloVibeRamp;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloLivesBtns.querySelectorAll('[data-hilo-lives]').forEach(b => {
      const sel = parseInt(b.dataset.hiloLives, 10) === selectedHiloLives;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    root.querySelectorAll('[data-hilo-vibe-target]').forEach(b => {
      const sel = b.dataset.hiloVibeTarget === selectedHiloVibeTarget;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    roundsBtns.querySelectorAll('[data-rounds]').forEach(b => {
      const sel = parseInt(b.dataset.rounds, 10) === selectedRounds;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    modeBtns.querySelectorAll('[data-mode]').forEach(b => {
      const sel = b.dataset.mode === selectedMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    const isHilo = selectedGame === 'hilo';
    const isStl = selectedGame === 'splitloot';
    const isWi = selectedGame === 'wizardisland';
    const isBtd = selectedGame === 'beatdealer';
    const isSo = selectedGame === 'standoff';
    const isLc = selectedGame === 'lastcall';
    const isBs = selectedGame === 'battleships';
    const isMemory = selectedGame === 'memory';
    const isUno = selectedGame === 'uno';
    const isSnl = selectedGame === 'snakes';
    snlConfig.style.display = isSnl ? 'block' : 'none';
    if (isSnl) {
      snlModeBtns.querySelectorAll('[data-snl-mode]').forEach(b => {
        const sel = b.dataset.snlMode === selectedSnlMode;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlBoardBtns.querySelectorAll('[data-snl-board]').forEach(b => {
        const sel = b.dataset.snlBoard === selectedSnlBoardSize;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlDensityBtns.querySelectorAll('[data-snl-density]').forEach(b => {
        const sel = b.dataset.snlDensity === selectedSnlDensity;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlStakeBtns.querySelectorAll('[data-snl-stake]').forEach(b => {
        const sel = b.dataset.snlStake === selectedSnlStakeMix;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlWinBtns.querySelectorAll('[data-snl-win]').forEach(b => {
        const sel = b.dataset.snlWin === selectedSnlWinCondition;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlFinalRuleRow.style.display = selectedSnlWinCondition === 'race' ? 'flex' : 'none';
      snlFinalRuleBtns.querySelectorAll('[data-snl-final]').forEach(b => {
        const sel = b.dataset.snlFinal === selectedSnlFinalRule;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlPowerupsBtns.querySelectorAll('[data-snl-powerups]').forEach(b => {
        const sel = (b.dataset.snlPowerups === 'on') === selectedSnlPowerups;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      const vsMode = selectedSnlMode === 'versus';
      snlForkRow.style.display = vsMode ? 'flex' : 'none';
      snlForkBtns.querySelectorAll('[data-snl-fork]').forEach(b => {
        const sel = (b.dataset.snlFork === 'on') === selectedSnlCoopBetray;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlCardsRow.querySelectorAll('[data-snl-card]').forEach(b => {
        const sel = selectedSnlForfeitCards.includes(b.dataset.snlCard);
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlForfeitsInput.disabled = state.role !== 'host';
      if (document.activeElement !== snlForfeitsInput) {
        snlForfeitsInput.value = selectedSnlForfeitLines.join('\n');
      }
      const soloWatched = selectedSnlMode === 'solo' || selectedSnlMode === 'watched';
      snlAmbientRow.style.display = soloWatched ? 'flex' : 'none';
      snlAmbientBtns.querySelectorAll('[data-snl-ambient]').forEach(b => {
        const sel = (b.dataset.snlAmbient === 'on') === selectedSnlAmbient;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
      snlTapOutRow.style.display = soloWatched ? 'flex' : 'none';
      snlTapOutBtns.querySelectorAll('[data-snl-tapout]').forEach(b => {
        const sel = (b.dataset.snlTapout === 'on') === selectedSnlTapOut;
        b.classList.toggle('mm-rounds-selected', sel);
        b.classList.toggle('ghost', !sel);
        b.disabled = state.role !== 'host';
      });
    }
    memConfig.style.display = selectedGame === 'memory' ? 'block' : 'none';
    memModeBtns.querySelectorAll('[data-mem-mode]').forEach(b => {
      const sel = b.dataset.memMode === selectedMemMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
      b.disabled = state.role !== 'host';
    });
    memModeDesc.textContent = MEM_MODE_DESC[selectedMemMode] || '';
    memGridBtns.querySelectorAll('[data-mem-grid]').forEach(b => {
      const sel = b.dataset.memGrid === selectedMemGridSize;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
      b.disabled = state.role !== 'host';
    });
    memForfeitsInput.disabled = state.role !== 'host';
    if (document.activeElement !== memForfeitsInput) {
      memForfeitsInput.value = selectedMemForfeitLines.join('\n');
    }
    memVibeDurationsInput.disabled = state.role !== 'host';
    if (document.activeElement !== memVibeDurationsInput) {
      memVibeDurationsInput.value = selectedMemVibeDurations.join('\n');
    }
    updateMemBudget();
    unoConfig.style.display = isUno ? 'block' : 'none';
    unoRoundsBtns.querySelectorAll('[data-uno-rounds]').forEach(b => {
      const sel = parseInt(b.dataset.unoRounds, 10) === selectedUnoRounds;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
      b.disabled = state.role !== 'host';
    });
    unoPacksGrid.querySelectorAll('[data-uno-pack]').forEach(b => {
      const sel = selectedUnoSpecialPacks.includes(b.dataset.unoPack);
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
      b.disabled = state.role !== 'host';
    });
    const hideForfeit = isHilo || isStl || isWi || isBtd || isSo || isBs || isUno || isSnl || isMemory || (isLc && !selectedLcTimer);
    const noEdge = isHilo || isStl || isWi || isBtd || isSo || isLc || isBs || isUno || isSnl || isMemory;
    forfeitRow.style.display   = hideForfeit ? 'none' : '';
    edgeModeRow.style.display  = noEdge ? 'none' : '';
    if (noEdge) edgeLivesRow.style.display = 'none';
    forfeitBtns.querySelectorAll('[data-forfeit]').forEach(b => {
      const sel = parseInt(b.dataset.forfeit, 10) === selectedForfeit;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    edgeBtns.querySelectorAll('[data-edge]').forEach(b => {
      const sel = (b.dataset.edge === 'on') === selectedEdgeMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    edgeLivesRow.style.display = selectedEdgeMode ? 'flex' : 'none';
    edgeLivesBtns.querySelectorAll('[data-lives]').forEach(b => {
      const sel = parseInt(b.dataset.lives, 10) === selectedEdgeLives;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    // Refresh start button when game selection changes (solo-capable games can start without a guest)
    const _soloGames = ['beatdealer', 'hilo', 'mastermind', 'lastcall'];
    let _isSolo = _soloGames.includes(selectedGame);
    if (selectedGame === 'snakes' && selectedSnlMode === 'solo') _isSolo = true;
    if (selectedGame === 'memory' && selectedMemMode === 'solo') _isSolo = true;
    const _memOk = selectedGame !== 'memory' || selectedMemFits;
    const _canStart = state.role === 'host' && state.hostName && (state.guestName || _isSolo) && _memOk;
    startBtn.disabled = !_canStart;
    startBtn.textContent = state.role === 'host'
      ? (_canStart ? (state.guestName ? 'Start' : 'Play Solo') : 'Waiting for guest…')
      : 'Waiting for host…';
  }

  const sendConfig = () => socket.send({
    type: MSG.LOBBY_CONFIG,
    devMode: state.devMode,
    gameType: selectedGame,
    rounds: selectedRounds,
    mode: selectedMode,
    forfeitDuration: selectedForfeit,
    edgeMode: selectedEdgeMode,
    edgeLives: selectedEdgeLives,
    hiloMode: selectedHiloMode,
    hiloCycles: selectedHiloCycles,
    hiloDeckSize: selectedHiloDeckSize,
    hiloVibeRamp: selectedHiloVibeRamp,
    hiloLives: selectedHiloLives,
    hiloVibeTarget: selectedHiloVibeTarget,
    stlDifficulty: selectedStlDifficulty,
    stlForfeitCards: selectedStlForfeitCards,
    btdForfeits: selectedBtdForfeits,
    btdMode: selectedBtdMode,
    btdGameMode: selectedBtdGameMode,
    wiWinCondition: selectedWiWinCondition,
    wiSpellLimit: selectedWiSpellLimit,
    diceVibeRule: selectedDiceVibeRule,
    lcTimer: selectedLcTimer,
    lcMinutes: selectedLcMinutes,
    lcDeckSize: selectedLcDeckSize,
    lcReward: selectedLcReward,
    bsGridSize: selectedBsGridSize,
    bsVibeMultiplier: selectedBsVibeMultiplier,
    unoRounds: selectedUnoRounds,
    unoSpecialPacks: selectedUnoSpecialPacks,
    snlMode: selectedSnlMode,
    snlBoardSize: selectedSnlBoardSize,
    snlDensity: selectedSnlDensity,
    snlStakeMix: selectedSnlStakeMix,
    snlVibeScale: selectedSnlVibeScale,
    snlWinCondition: selectedSnlWinCondition,
    snlFinalRule: selectedSnlFinalRule,
    snlPowerups: selectedSnlPowerups,
    snlCoopBetray: selectedSnlCoopBetray,
    snlForfeitCards: selectedSnlForfeitCards,
    snlForfeitLines: selectedSnlForfeitLines,
    snlAmbient: selectedSnlAmbient,
    snlTapOut: selectedSnlTapOut,
    memMode: selectedMemMode,
    memForfeitLines: selectedMemForfeitLines,
    memVibeDurations: selectedMemVibeDurations,
    memGridSize: selectedMemGridSize,
  });

  socket.connect();
  socket.send({ type: MSG.JOIN, sessionId: state.sessionId, name: state.myName });

  const onLobby = (ev) => {
    const hadGuest = !!state.guestName;
    state.hostName = ev.detail.host?.name || null;
    state.guestName = ev.detail.guest?.name || null;
    state.guest2Name = ev.detail.guest2?.name || null;
    if (state.role === 'host' && !hadGuest && state.guestName) sendConfig();
    paint();
  };
  const onJoined = (ev) => { state.role = ev.detail.role; paint(); };
  const onError = (ev) => {
    if (ev.detail.code === 'no_session') showError(errEl, 'That session no longer exists.');
    else if (ev.detail.code === 'session_full') showError(errEl, 'This session is already full.');
  };
  const onPeerLeft = (ev) => {
    const leftRole = ev.detail?.role;
    if (leftRole === 'host') state.hostName = null;
    else if (leftRole === 'guest') state.guestName = null;
    else if (leftRole === 'guest2') state.guest2Name = null;
    else {
      // fallback for older server: clear based on my role
      if (state.role === 'host') state.guestName = null;
      else state.hostName = null;
    }
    paint();
    showError(errEl, 'A player left.');
  };

  const onLobbyConfig = (ev) => {
    const modeChanged = ev.detail.devMode !== undefined && !!ev.detail.devMode !== state.devMode;
    if (ev.detail.devMode !== undefined) state.devMode = !!ev.detail.devMode;
    selectedGame      = ev.detail.gameType        || selectedGame;
    selectedRounds    = ev.detail.rounds          || selectedRounds;
    selectedMode      = ev.detail.mode            || selectedMode;
    selectedForfeit   = ev.detail.forfeitDuration || selectedForfeit;
    if (ev.detail.edgeMode !== undefined) selectedEdgeMode = !!ev.detail.edgeMode;
    if (ev.detail.edgeLives)              selectedEdgeLives = ev.detail.edgeLives;
    if (ev.detail.hiloMode)                    selectedHiloMode = ev.detail.hiloMode;
    if (ev.detail.hiloCycles !== undefined)    selectedHiloCycles = ev.detail.hiloCycles;
    if (ev.detail.hiloDeckSize !== undefined)  selectedHiloDeckSize = ev.detail.hiloDeckSize;
    if (ev.detail.hiloVibeRamp)               selectedHiloVibeRamp = ev.detail.hiloVibeRamp;
    if (ev.detail.hiloLives)                   selectedHiloLives = ev.detail.hiloLives;
    if (ev.detail.hiloVibeTarget)              selectedHiloVibeTarget = ev.detail.hiloVibeTarget;
    if (ev.detail.stlDifficulty)               selectedStlDifficulty = ev.detail.stlDifficulty;
    if (ev.detail.stlForfeitCards)             selectedStlForfeitCards = ev.detail.stlForfeitCards;
    if (ev.detail.btdForfeits)                 selectedBtdForfeits = ev.detail.btdForfeits;
    if (ev.detail.btdMode)                     selectedBtdMode = ev.detail.btdMode;
    if (ev.detail.btdGameMode)                 selectedBtdGameMode = ev.detail.btdGameMode;
    if (ev.detail.wiWinCondition)              selectedWiWinCondition = ev.detail.wiWinCondition;
    if (ev.detail.wiSpellLimit !== undefined)  selectedWiSpellLimit = ev.detail.wiSpellLimit;
    if (ev.detail.diceVibeRule)                selectedDiceVibeRule = ev.detail.diceVibeRule;
    if (ev.detail.lcTimer !== undefined)       selectedLcTimer = !!ev.detail.lcTimer;
    if (ev.detail.lcMinutes)                   selectedLcMinutes = ev.detail.lcMinutes;
    if (ev.detail.lcDeckSize !== undefined)        selectedLcDeckSize = ev.detail.lcDeckSize;
    if (ev.detail.lcReward)                        selectedLcReward = ev.detail.lcReward;
    if (ev.detail.bsGridSize)                      selectedBsGridSize = ev.detail.bsGridSize;
    if (ev.detail.bsVibeMultiplier !== undefined)  selectedBsVibeMultiplier = ev.detail.bsVibeMultiplier;
    if (ev.detail.unoRounds)                        selectedUnoRounds = ev.detail.unoRounds;
    if (ev.detail.unoSpecialPacks)                  selectedUnoSpecialPacks = ev.detail.unoSpecialPacks;
    if (ev.detail.snlMode)                          selectedSnlMode = ev.detail.snlMode;
    if (ev.detail.snlBoardSize)                     selectedSnlBoardSize = ev.detail.snlBoardSize;
    if (ev.detail.snlDensity)                       selectedSnlDensity = ev.detail.snlDensity;
    if (ev.detail.snlStakeMix)                      selectedSnlStakeMix = ev.detail.snlStakeMix;
    if (ev.detail.snlVibeScale)                     selectedSnlVibeScale = ev.detail.snlVibeScale;
    if (ev.detail.snlWinCondition)                  selectedSnlWinCondition = ev.detail.snlWinCondition;
    if (ev.detail.snlFinalRule)                     selectedSnlFinalRule = ev.detail.snlFinalRule;
    if (ev.detail.snlPowerups !== undefined)        selectedSnlPowerups = !!ev.detail.snlPowerups;
    if (ev.detail.snlCoopBetray !== undefined)      selectedSnlCoopBetray = !!ev.detail.snlCoopBetray;
    if (ev.detail.snlForfeitCards)                  selectedSnlForfeitCards = ev.detail.snlForfeitCards;
    if (ev.detail.snlForfeitLines)                  selectedSnlForfeitLines = ev.detail.snlForfeitLines;
    if (ev.detail.snlAmbient !== undefined)         selectedSnlAmbient = !!ev.detail.snlAmbient;
    if (ev.detail.snlTapOut !== undefined)          selectedSnlTapOut = !!ev.detail.snlTapOut;
    if (ev.detail.memMode)                          selectedMemMode = ev.detail.memMode;
    if (ev.detail.memForfeitLines)                  selectedMemForfeitLines = ev.detail.memForfeitLines;
    if (ev.detail.memVibeDurations)                 selectedMemVibeDurations = ev.detail.memVibeDurations;
    if (ev.detail.memGridSize)                      selectedMemGridSize = ev.detail.memGridSize;
    if (modeChanged) { renderLobby(root); return; }
    paintOptions();
  };

  socket.addEventListener(MSG.LOBBY, onLobby);
  socket.addEventListener(MSG.JOINED, onJoined);
  socket.addEventListener(MSG.ERROR, onError);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);
  socket.addEventListener(MSG.LOBBY_CONFIG, onLobbyConfig);

  const cleanup = () => {
    socket.removeEventListener(MSG.LOBBY, onLobby);
    socket.removeEventListener(MSG.JOINED, onJoined);
    socket.removeEventListener(MSG.ERROR, onError);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    socket.removeEventListener(MSG.LOBBY_CONFIG, onLobbyConfig);
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  gameList.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const tile = e.target.closest('[data-game]');
    if (!tile) return;
    selectedGame = tile.dataset.game;
    paintOptions();
    sendConfig();
  });

  roundsBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-rounds]');
    if (!btn) return;
    selectedRounds = parseInt(btn.dataset.rounds, 10);
    paintOptions();
    sendConfig();
  });

  modeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    selectedMode = btn.dataset.mode;
    paintOptions();
    sendConfig();
  });

  btdGamemodeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-btd-gamemode]');
    if (!btn) return;
    selectedBtdGameMode = btn.dataset.btdGamemode;
    paintOptions();
    sendConfig();
  });

  btdModeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-btd-mode]');
    if (!btn) return;
    selectedBtdMode = btn.dataset.btdMode;
    paintOptions();
    sendConfig();
  });

  memModeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-mem-mode]');
    if (!btn) return;
    selectedMemMode = btn.dataset.memMode;
    paintOptions();
    sendConfig();
  });

  memGridBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-mem-grid]');
    if (!btn) return;
    selectedMemGridSize = btn.dataset.memGrid;
    paintOptions();
    sendConfig();
  });

  snlForfeitsInput.addEventListener('input', () => {
    if (state.role !== 'host') return;
    selectedSnlForfeitLines = snlForfeitsInput.value
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, 100);
    sendConfig();
  });

  memForfeitsInput.addEventListener('input', () => {
    if (state.role !== 'host') return;
    selectedMemForfeitLines = memForfeitsInput.value
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, 60);
    updateMemBudget();
    sendConfig();
  });

  memVibeDurationsInput.addEventListener('input', () => {
    if (state.role !== 'host') return;
    selectedMemVibeDurations = memVibeDurationsInput.value
      .split('\n')
      .map(l => parseInt(l.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0)
      .slice(0, 30);
    updateMemBudget();
    sendConfig();
  });

  btdForfeitsInput.addEventListener('input', () => {
    if (state.role !== 'host') return;
    selectedBtdForfeits = btdForfeitsInput.value
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, 100);
    btdForfeitsCount.textContent = selectedBtdForfeits.length
      ? `${selectedBtdForfeits.length} forfeit${selectedBtdForfeits.length === 1 ? '' : 's'} in the deck`
      : 'Empty — using built-in forfeits';
    sendConfig();
  });

  forfeitBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-forfeit]');
    if (!btn) return;
    selectedForfeit = parseInt(btn.dataset.forfeit, 10);
    paintOptions();
    sendConfig();
  });

  edgeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-edge]');
    if (!btn) return;
    selectedEdgeMode = btn.dataset.edge === 'on';
    paintOptions();
    sendConfig();
  });

  edgeLivesBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-lives]');
    if (!btn) return;
    selectedEdgeLives = parseInt(btn.dataset.lives, 10);
    paintOptions();
    sendConfig();
  });

  startBtn.addEventListener('click', () => {
    socket.send({ type: MSG.START, gameType: selectedGame, rounds: selectedGame === 'uno' ? selectedUnoRounds : selectedRounds, mode: selectedMode, forfeitDuration: selectedForfeit, edgeMode: selectedEdgeMode, edgeLives: selectedEdgeLives, hiloMode: selectedHiloMode, hiloCycles: selectedHiloCycles, hiloDeckSize: selectedHiloDeckSize, hiloVibeRamp: selectedHiloVibeRamp, hiloLives: selectedHiloLives, hiloVibeTarget: selectedHiloVibeTarget, stlDifficulty: selectedStlDifficulty, stlForfeitCards: selectedStlForfeitCards, btdForfeits: selectedBtdForfeits, btdMode: selectedBtdMode, btdGameMode: selectedBtdGameMode, wiWinCondition: selectedWiWinCondition, wiSpellLimit: selectedWiSpellLimit, diceVibeRule: selectedDiceVibeRule, lcTimer: selectedLcTimer, lcMinutes: selectedLcMinutes, lcDeckSize: selectedLcDeckSize, lcReward: selectedLcReward, bsGridSize: selectedBsGridSize, bsVibeMultiplier: selectedBsVibeMultiplier, unoRounds: selectedUnoRounds, unoSpecialPacks: selectedUnoSpecialPacks, snlMode: selectedSnlMode, snlBoardSize: selectedSnlBoardSize, snlDensity: selectedSnlDensity, snlStakeMix: selectedSnlStakeMix, snlVibeScale: selectedSnlVibeScale, snlWinCondition: selectedSnlWinCondition, snlFinalRule: selectedSnlFinalRule, snlPowerups: selectedSnlPowerups, snlCoopBetray: selectedSnlCoopBetray, snlForfeitCards: selectedSnlForfeitCards, snlForfeitLines: selectedSnlForfeitLines, snlAmbient: selectedSnlAmbient, snlTapOut: selectedSnlTapOut, memMode: selectedMemMode, memForfeitLines: selectedMemForfeitLines, memVibeDurations: selectedMemVibeDurations, memGridSize: selectedMemGridSize });
  });

  wiWinBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-wi-win]');
    if (!btn) return;
    selectedWiWinCondition = btn.dataset.wiWin;
    paintOptions();
    sendConfig();
  });

  wiLimitBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-wi-limit]');
    if (!btn) return;
    selectedWiSpellLimit = parseInt(btn.dataset.wiLimit, 10);
    paintOptions();
    sendConfig();
  });

  diceRuleBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-dice-rule]');
    if (!btn) return;
    selectedDiceVibeRule = btn.dataset.diceRule;
    paintOptions();
    sendConfig();
  });

  lcTimerBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-lc-timer]');
    if (!btn) return;
    selectedLcTimer = btn.dataset.lcTimer === 'on';
    paintOptions();
    sendConfig();
  });

  lcMinutesBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-lc-minutes]');
    if (!btn) return;
    selectedLcMinutes = parseInt(btn.dataset.lcMinutes, 10);
    paintOptions();
    sendConfig();
  });

  lcDeckBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-lc-deck]');
    if (!btn) return;
    selectedLcDeckSize = parseInt(btn.dataset.lcDeck, 10);
    paintOptions();
    sendConfig();
  });

  lcRewardBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-lc-reward]');
    if (!btn) return;
    selectedLcReward = btn.dataset.lcReward;
    paintOptions();
    sendConfig();
  });

  bsGridBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-bs-grid]');
    if (!btn) return;
    selectedBsGridSize = btn.dataset.bsGrid;
    paintOptions();
    sendConfig();
  });

  bsVibeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-bs-mult]');
    if (!btn) return;
    selectedBsVibeMultiplier = parseFloat(btn.dataset.bsMult);
    paintOptions();
    sendConfig();
  });

  unoRoundsBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-uno-rounds]');
    if (!btn) return;
    selectedUnoRounds = parseInt(btn.dataset.unoRounds, 10);
    paintOptions();
    sendConfig();
  });

  unoPacksGrid.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-uno-pack]');
    if (!btn) return;
    const pack = btn.dataset.unoPack;
    if (selectedUnoSpecialPacks.includes(pack)) {
      selectedUnoSpecialPacks = selectedUnoSpecialPacks.filter(p => p !== pack);
    } else {
      selectedUnoSpecialPacks = [...selectedUnoSpecialPacks, pack];
    }
    paintOptions();
    sendConfig();
  });

  snlConfig.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const modeBtn = e.target.closest('[data-snl-mode]');
    if (modeBtn) { selectedSnlMode = modeBtn.dataset.snlMode; paintOptions(); sendConfig(); return; }
    const boardBtn = e.target.closest('[data-snl-board]');
    if (boardBtn) { selectedSnlBoardSize = boardBtn.dataset.snlBoard; paintOptions(); sendConfig(); return; }
    const densityBtn = e.target.closest('[data-snl-density]');
    if (densityBtn) { selectedSnlDensity = densityBtn.dataset.snlDensity; paintOptions(); sendConfig(); return; }
    const stakeBtn = e.target.closest('[data-snl-stake]');
    if (stakeBtn) { selectedSnlStakeMix = stakeBtn.dataset.snlStake; paintOptions(); sendConfig(); return; }
    const winBtn = e.target.closest('[data-snl-win]');
    if (winBtn) { selectedSnlWinCondition = winBtn.dataset.snlWin; paintOptions(); sendConfig(); return; }
    const finalBtn = e.target.closest('[data-snl-final]');
    if (finalBtn) { selectedSnlFinalRule = finalBtn.dataset.snlFinal; paintOptions(); sendConfig(); return; }
    const powerupsBtn = e.target.closest('[data-snl-powerups]');
    if (powerupsBtn) { selectedSnlPowerups = powerupsBtn.dataset.snlPowerups === 'on'; paintOptions(); sendConfig(); return; }
    const forkBtn = e.target.closest('[data-snl-fork]');
    if (forkBtn) { selectedSnlCoopBetray = forkBtn.dataset.snlFork === 'on'; paintOptions(); sendConfig(); return; }
    const cardBtn = e.target.closest('[data-snl-card]');
    if (cardBtn) {
      const card = cardBtn.dataset.snlCard;
      if (selectedSnlForfeitCards.includes(card)) {
        selectedSnlForfeitCards = selectedSnlForfeitCards.filter(c => c !== card);
      } else {
        selectedSnlForfeitCards = [...selectedSnlForfeitCards, card];
      }
      paintOptions(); sendConfig(); return;
    }
    const ambientBtn = e.target.closest('[data-snl-ambient]');
    if (ambientBtn) { selectedSnlAmbient = ambientBtn.dataset.snlAmbient === 'on'; paintOptions(); sendConfig(); return; }
    const tapOutBtn = e.target.closest('[data-snl-tapout]');
    if (tapOutBtn) { selectedSnlTapOut = tapOutBtn.dataset.snlTapout === 'on'; paintOptions(); sendConfig(); return; }
  });

  stlConfig.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const diffBtn = e.target.closest('[data-stl-diff]');
    if (diffBtn) { selectedStlDifficulty = diffBtn.dataset.stlDiff; paintOptions(); sendConfig(); return; }
    const cardBtn = e.target.closest('[data-stl-card]');
    if (cardBtn) {
      const card = cardBtn.dataset.stlCard;
      if (selectedStlForfeitCards.includes(card)) {
        selectedStlForfeitCards = selectedStlForfeitCards.filter(c => c !== card);
      } else {
        selectedStlForfeitCards = [...selectedStlForfeitCards, card];
      }
      paintOptions();
      sendConfig();
    }
  });

  hiloModeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-mode]');
    if (!btn) return;
    selectedHiloMode = btn.dataset.hiloMode;
    paintOptions();
    sendConfig();
  });

  hiloCyclesBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-cycles]');
    if (!btn) return;
    selectedHiloCycles = parseInt(btn.dataset.hiloCycles, 10);
    paintOptions();
    sendConfig();
  });

  hiloDeckBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-deck]');
    if (!btn) return;
    selectedHiloDeckSize = parseInt(btn.dataset.hiloDeck, 10);
    paintOptions();
    sendConfig();
  });

  hiloRampBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-ramp]');
    if (!btn) return;
    selectedHiloVibeRamp = parseInt(btn.dataset.hiloRamp, 10);
    paintOptions();
    sendConfig();
  });

  hiloLivesBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-lives]');
    if (!btn) return;
    selectedHiloLives = parseInt(btn.dataset.hiloLives, 10);
    paintOptions();
    sendConfig();
  });

  root.querySelector('#hilo-vibe-target-btns').addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-vibe-target]');
    if (!btn) return;
    selectedHiloVibeTarget = btn.dataset.hiloVibeTarget;
    paintOptions();
    sendConfig();
  });

  root.querySelector('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/#/session/${state.sessionId}`);
      root.querySelector('#copy').textContent = 'Copied!';
      setTimeout(() => { const b = root.querySelector('#copy'); if (b) b.textContent = 'Copy link'; }, 1500);
    } catch {}
  });

  root.querySelector('#leave').addEventListener('click', () => {
    socket.close();
    navigate('#/');
  });

  const vibeBtBtn = root.querySelector('#btn-vibe-bt');
  const vibeIntifaceBtn = root.querySelector('#btn-vibe-intiface');
  const vibeHint = root.querySelector('#vibe-hint');
  if (haptics.isConnected()) {
    vibeHint.textContent = '📳 Connected';
  }

  async function connectVibe(mode, btn) {
    const other = btn === vibeBtBtn ? vibeIntifaceBtn : vibeBtBtn;
    const originalLabel = btn.textContent;
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    other.disabled = true;
    vibeHint.textContent = mode === 'intiface'
      ? 'Make sure Intiface Central is running on port 12345.'
      : 'Approve the Bluetooth pairing dialog in the browser.';
    try {
      const dev = await haptics.connect(mode);
      vibeHint.textContent = dev ? `📳 ${dev.name} ready` : 'No device found — try again.';
    } catch (err) {
      vibeHint.textContent = `Failed: ${err.message ?? err}`;
    }
    btn.textContent = haptics.isConnected() ? '📳 Connected — reconnect' : originalLabel;
    btn.disabled = false;
    other.disabled = false;
  }

  vibeBtBtn.addEventListener('click', () => connectVibe('bluetooth', vibeBtBtn));
  vibeIntifaceBtn.addEventListener('click', () => connectVibe('intiface', vibeIntifaceBtn));

  root.querySelector('#btn-test-vibe').addEventListener('click', () => {
    openTestVibeOverlay(state, socket, haptics);
  });

  function paint() {
    const ph = root.querySelector('#p-host');
    const pg = root.querySelector('#p-guest');
    const pg2 = root.querySelector('#p-guest2');
    if (ph) {
      ph.classList.toggle('empty', !state.hostName);
      ph.querySelector('.name').textContent = state.hostName || 'waiting…';
    }
    if (pg) {
      pg.classList.toggle('empty', !state.guestName);
      pg.querySelector('.name').textContent = state.guestName || 'waiting for player 2…';
    }
    if (pg2) {
      pg2.classList.toggle('empty', !state.guest2Name);
      pg2.querySelector('.name').textContent = state.guest2Name || 'player 3 (optional)…';
    }
    paintOptions();
  }
  paint();
}

function _renderNameEntry(root) {
  root.innerHTML = `
    <div class="card">
      <h1>Ed's Game Hub</h1>
      <label for="join-name">Your name</label>
      <input id="join-name" type="text" maxlength="24" placeholder="e.g. Alice" />
      <div id="join-err"></div>
      <div class="actions">
        <button class="ghost" id="join-cancel">Cancel</button>
        <button id="join-submit">Join game</button>
      </div>
    </div>
  `;

  const nameEl = root.querySelector('#join-name');
  const errEl  = root.querySelector('#join-err');
  nameEl.focus();

  const submit = () => {
    const name = nameEl.value.trim();
    if (!name) { errEl.innerHTML = '<div class="error">Please enter a name.</div>'; return; }
    state.myName = name.slice(0, 24);
    renderLobby(root);
  };

  root.querySelector('#join-submit').addEventListener('click', submit);
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  root.querySelector('#join-cancel').addEventListener('click', () => navigate('#/'));
}

function showError(el, msg) {
  el.innerHTML = `<div class="error">${escapeHtml(msg)}</div>`;
}

function openTestVibeOverlay(state, socket, haptics) {
  const myRole = state.role;
  const myName = state.myName || 'You';
  const is3 = !!state.guest2Name;

  const allPlayers = [
    { role: 'host',   name: state.hostName   || 'Host' },
    { role: 'guest',  name: state.guestName  || 'Guest' },
  ];
  if (is3) allPlayers.push({ role: 'guest2', name: state.guest2Name || 'Guest 2' });
  const others = allPlayers.filter(p => p.role !== myRole);

  const myPanel = `
    <div class="tv-panel">
      <div class="tv-panel-name">${escapeHtml(myName)}</div>
      <div class="tv-panel-label">Your device</div>
      <div class="tv-level" id="tv-my-level">0%</div>
      <input type="range" id="tv-my-slider" min="0" max="100" value="0" class="tv-slider tv-slider-mine">
      <div class="tv-panel-hint">${haptics.isConnected() ? '📳 Connected' : 'No device — connect first'}</div>
    </div>`;

  const otherPanels = others.map(p => `
    <div class="tv-panel">
      <div class="tv-panel-name">${escapeHtml(p.name)}</div>
      <div class="tv-panel-label">Their device</div>
      <div class="tv-level tv-level-opp" id="tv-opp-level-${p.role}">0%</div>
      <input type="range" id="tv-opp-slider-${p.role}" min="0" max="100" value="0" class="tv-slider tv-slider-opp" data-target="${p.role}">
      <div class="tv-panel-hint">Sends vibe to ${escapeHtml(p.name)}</div>
    </div>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box tv-box${is3 ? ' tv-box-3' : ''}">
      <h2>Test Vibe</h2>
      <p class="instructions-meta">Confirm all devices are working before the game starts.</p>
      <div class="tv-panels${is3 ? ' tv-panels-3' : ''}">
        ${myPanel}${otherPanels}
      </div>
      <p class="tv-hint">All players can open this screen independently.</p>
      <div class="actions" style="margin-top:16px;justify-content:center;">
        <button id="tv-close">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const mySlider  = overlay.querySelector('#tv-my-slider');
  const myLevelEl = overlay.querySelector('#tv-my-level');

  mySlider.addEventListener('input', () => {
    myLevelEl.textContent = `${mySlider.value}%`;
    haptics.testVibe(mySlider.value / 100);
  });

  overlay.querySelectorAll('[data-target]').forEach(slider => {
    slider.addEventListener('input', () => {
      const target = slider.dataset.target;
      const levelEl = overlay.querySelector(`#tv-opp-level-${target}`);
      if (levelEl) levelEl.textContent = `${slider.value}%`;
      socket.send({ type: MSG.VIBE_TEST, level: slider.value / 100, target });
    });
  });

  // Another player testing my device — apply and reflect in my slider
  const onVibeTest = (ev) => {
    const level = ev.detail.level;
    haptics.testVibe(level);
    mySlider.value = Math.round(level * 100);
    myLevelEl.textContent = `${mySlider.value}%`;
  };
  socket.addEventListener(MSG.VIBE_TEST, onVibeTest);

  const close = () => {
    haptics.testVibe(0);
    others.forEach(p => socket.send({ type: MSG.VIBE_TEST, level: 0, target: p.role }));
    socket.removeEventListener(MSG.VIBE_TEST, onVibeTest);
    overlay.remove();
  };

  overlay.querySelector('#tv-close').addEventListener('click', close);
  window.addEventListener('hashchange', close, { once: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
