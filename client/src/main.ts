/** Entry point: finds the canvas and the overlay root in the page and starts the app. */

import { App } from './app/app';
import './styles.css';
import './kaiju.css';

const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !ui) {
  throw new Error('index.html must contain <canvas id="view"> and <div id="ui">');
}
const app = new App(canvas, ui);
// `start` reports its own failures (on the console and as a picture on the boot screen).
void app.start();
