import { useState } from 'react';
import { createGame, type GameState } from './engine/game';
import { randomSeed } from './engine/rng';
import { GameScreen } from './ui/GameScreen';
import { SetupScreen } from './ui/SetupScreen';

export function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [gameId, setGameId] = useState(0);

  if (!game) {
    return (
      <SetupScreen
        onStart={(players) => {
          setGame(createGame(players, randomSeed()));
          setGameId((n) => n + 1);
        }}
      />
    );
  }

  return (
    <GameScreen
      key={gameId}
      initial={game}
      onQuit={(force?: boolean) => {
        if (force || window.confirm('Spiel wirklich verlassen? Der Spielstand geht verloren.')) setGame(null);
      }}
    />
  );
}
