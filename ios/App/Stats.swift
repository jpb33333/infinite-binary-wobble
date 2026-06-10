import Foundation
import WobblePhysics

// Per-session scoreboard (port of src/game/stats.ts). In-memory on purpose —
// the web version's cookie clears when the browser closes; "per session"
// here means per app run. No accounts, no network, nothing persisted.

struct GameRecord {
  let outcome: Outcome
  let duration: Double
  let eccentricity: Double
  let orbits: Int
}

struct StatsSummary {
  var total = 0
  var wins = 0
  var drifted = 0    // lose_escape + lose_slingshot
  var collided = 0
  var bestOrbits: Int? = nil

  var winRate: Double { total > 0 ? Double(wins) / Double(total) : 0 }
}

final class SessionStats {
  private(set) var games: [GameRecord] = []
  private let maxGames = 100

  func record(_ g: GameRecord) {
    games.append(g)
    if games.count > maxGames { games.removeFirst(games.count - maxGames) }
  }

  func reset() { games.removeAll() }

  var summary: StatsSummary {
    var s = StatsSummary()
    s.total = games.count
    for g in games {
      switch g.outcome {
      case .win:
        s.wins += 1
        s.bestOrbits = max(s.bestOrbits ?? 0, g.orbits)
      case .loseEscape, .loseSlingshot: s.drifted += 1
      case .loseCollision: s.collided += 1
      case .playing: break
      }
    }
    return s
  }
}
