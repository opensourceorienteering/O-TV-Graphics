import { createGraphic } from '../../_core/graphic.js';
import set from '../set.js';
import { createFinishWatchView } from './view.js';

const Base = createGraphic('finish-watch', set, function(data, ctx) {
  return this.finishWatchView(data, ctx);
});
export default class FinishWatch extends Base {
  async load(params) {
    this.finishWatchView = createFinishWatchView();
    return super.load(params);
  }
}
