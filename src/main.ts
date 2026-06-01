import './style.css';
import { Game } from './game/Game.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (!canvas) throw new Error('Stage canvas not found in index.html');

const game = new Game(canvas);
game.start();
