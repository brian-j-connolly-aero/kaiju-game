/** Entry point: finds the canvas and the overlay root in the page and starts the app. */

import { App } from './app/app';
import './styles.css';

const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !ui) {
  throw new Error('index.html must contain <canvas id="view"> and <div id="ui">');
}
const app = new App(canvas, ui);
app.start().catch((err: unknown) => {
  console.error('The game could not start.', err);
});
