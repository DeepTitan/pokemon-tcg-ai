import { ACTIVE_ELO_OPTIONS as active, ELO_OPTIONS as elo } from './parameters.js';
import { fadingLiveRatingUpdate } from './elo.js';

export default function ModelSettings() {
  const historyScale = active.liveFadeGames;
  const initialOwnLiveWeight = active.initialOwnLiveWeight;
  const exampleLive = 1900;
  const example = fadingLiveRatingUpdate(elo.initialRating, elo.initialRating, exampleLive, exampleLive, 1, 0, 0, active);
  const percent = (weight: number) => (weight * 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const historyExamples = [0, historyScale, 1000, 10000].map(games => ({
    games,
    evidence: fadingLiveRatingUpdate(elo.initialRating, elo.initialRating, exampleLive, exampleLive, 1, games, games, active).matchEvidence,
  }));

  return <section className="model-settings" id="method" aria-labelledby="model-heading">
    <div className="model-intro">
      <h1 id="model-heading">How ratings work</h1>
      <p>Your Trace rating is a score built from the ranked matches Trace records. It is separate from your rating in Pokémon TCG Live.</p>
    </div>

    <ol className="model-principles">
      <li>
        <span className="model-principle-number" aria-hidden="true">01</span>
        <h2>Everyone starts at {elo.initialRating.toLocaleString()}</h2>
        <p>Your Live rating does not change your starting score.</p>
      </li>
      <li>
        <span className="model-principle-number" aria-hidden="true">02</span>
        <h2>Wins add points</h2>
        <p>Wins add points. Losses take points away. Each match changes your score by up to {elo.k}, based on both players’ ratings.</p>
      </li>
      <li>
        <span className="model-principle-number" aria-hidden="true">03</span>
        <h2>Your matches matter more</h2>
        <p>Live ratings help when Trace has few matches to go on. As each player records more matches, their Live rating has less effect.</p>
      </li>
    </ol>

    <div className="model-equation">{elo.initialRating.toLocaleString()} + points won − points lost = <strong>your Trace rating</strong></div>

    <div className="model-basics">
      <div>
        <h2>Which matches count?</h2>
        <p>Ranked matches need a clear result and both players’ Live ratings recorded with the match. Matches without these details do not affect your score or appear in your match history.</p>
      </div>
      <div>
        <h2>What happens when Live resets?</h2>
        <p>You keep your Trace points. A lower Live rating can still affect points in later matches, especially for players with few matches recorded.</p>
      </div>
    </div>

    <details className="model-details">
      <summary>See a match example</summary>
      <div className="model-example">
        <h2>Two players with high Live ratings</h2>
        <p>It is the first recorded match for both players. Both start at {elo.initialRating.toLocaleString()} in Trace and have a Live rating of {exampleLive.toLocaleString()}.</p>
        <p><strong>A win adds {example.adjustment.toFixed(1)} points.</strong><br/><strong>A loss takes away {(elo.k * example.benchmark).toFixed(1)} points.</strong></p>
        <p>If both Live ratings were {elo.initialRating.toLocaleString()} instead, a win would add {elo.k / 2} points and a loss would take away {elo.k / 2}.</p>
        <p>This lets players facing stronger opponents build a higher Trace score, even with an even win–loss record. To do that, the formula gives the opponent’s Live rating more weight at first. The winner’s gain and the loser’s loss do not have to be equal.</p>
      </div>
    </details>

    <details className="model-details">
      <summary>See the settings and why we use them</summary>
      <p>These settings control how much scores change and how quickly Live ratings matter less. They are current choices, not values proven to be best for Pokémon.</p>
      <div className="table-scroll" tabIndex={0}>
        <table className="settings-table">
          <thead><tr><th>Setting</th><th>Value</th><th>Reason</th></tr></thead>
          <tbody>
            <tr><th scope="row">Starting score</th><td>{elo.initialRating.toLocaleString()}</td><td>Gives everyone the same starting point.</td></tr>
            <tr><th scope="row">Most points per match</th><td>{elo.k}</td><td>Keeps one match from moving a score too far. This is a chosen limit, not a value found by testing the data.</td></tr>
            <tr><th scope="row">Your Live rating’s starting weight</th><td>{percent(initialOwnLiveWeight)}%</td><td>Starts with your Trace rating and uses Live as an early guide. This weight is still being tested.</td></tr>
            <tr><th scope="row">Opponent’s Live rating’s starting weight</th><td>100%</td><td>Uses Live to judge an opponent Trace has not seen before.</td></tr>
            <tr><th scope="row">Matches to halve Live’s weight</th><td>{historyScale}</td><td>After {historyScale} matches, each player’s Live weight is half its starting value. This pace is still being tested.</td></tr>
            <tr><th scope="row">Rating-gap scale</th><td>{elo.expectedScale}</td><td>Controls how a gap between ratings affects points. This is a common Elo setting, not one fitted to Pokémon results.</td></tr>
          </tbody>
        </table>
      </div>
      <h2>How Live’s weight gets smaller</h2>
      <div className="table-scroll" tabIndex={0}>
        <table className="settings-table">
          <thead><tr><th>Matches already recorded</th><th>Your Live weight</th><th>Opponent’s Live weight</th></tr></thead>
          <tbody>{historyExamples.map(({ games, evidence }) => <tr key={games}>
            <th scope="row">{games.toLocaleString()}</th>
            <td>{percent(1 - evidence.ownTraceWeight)}%</td>
            <td>{percent(1 - evidence.opponentTraceWeight)}%</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="model-note">Each player’s match count is separate. Your long history does not reduce the Live weight of an opponent with few recorded matches. When both players have very long histories, the formula works almost entirely from their Trace ratings.</p>
    </details>

    <details className="model-details">
      <summary>See the full calculation</summary>
      <p>Trace processes matches from oldest to newest. Each update uses both players’ Trace ratings and match counts from before the match, plus the Live ratings recorded with it.</p>
      <div className="model-formula">
        a = {initialOwnLiveWeight} × {historyScale} / ({historyScale} + your prior matches)<br/>
        b = {historyScale} / ({historyScale} + opponent’s prior matches)<br/>
        Your value = (1 − a) × your Trace + a × your Live<br/>
        Opponent value = (1 − b) × opponent Trace + b × opponent Live<br/>
        Points factor = 1 / (1 + 10^((opponent value − your value) / {elo.expectedScale}))<br/>
        Match points = {elo.k} × (result − points factor)
      </div>
      <p><strong>Result:</strong> win = 1, draw = 0.5, loss = 0. A draw can add or remove points depending on the ratings.</p>
      <p><strong>Points factor:</strong> the number used to set the points for this match. A {elo.expectedScale}-point gap gives 10:1 odds in this formula, but those odds have not been tested as a reliable prediction of who will win.</p>
      <p>In the example above, your value is {example.matchEvidence.ownBlend.toLocaleString()} and your opponent’s is {example.matchEvidence.opponentBlend.toLocaleString()}. These values are used only to calculate points; they are not extra leaderboard scores.</p>
    </details>

    <details className="model-details">
      <summary>What else should I know?</summary>
      <ul className="model-list">
        <li><strong>Trace cannot count matches it does not see.</strong> Missing games, time away and repeatedly facing the same small group can make the rating less accurate. A large match count does not prove the history is complete or the rating is accurate.</li>
        <li><strong>“Few matches” means 1–{elo.provisionalGames - 1} counted matches.</strong> It is a heads-up about the amount of history, not a different formula. Being registered with Trace does not change match points either.</li>
        <li><strong>Live weight does not come back after a break.</strong> Early rating errors can last as Live’s effect gets smaller.</li>
        <li><strong>Missing or conflicting Live ratings exclude a match.</strong> Profile ratings and ratings marked as after-match are not used. Some older match records do not tell us exactly when the Live rating was captured.</li>
        <li><strong>A season reset can still affect future points.</strong> A known season correction can adjust the Live rating used when evidence was available at the time. It cannot recover the skill differences erased by a reset.</li>
      </ul>
    </details>
    <p className="model-review">We are still testing this rating. You can see the points from each counted match on any player’s page.</p>
  </section>;
}
