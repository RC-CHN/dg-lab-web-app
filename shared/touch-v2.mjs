// Official COYOTE_020 touch mapping: APK 43836 / 78617 / 83684.
export const defaultAxes = {
  intensity: [{position:0,value:0},{position:.33,value:100},{position:.66,value:100},{position:1,value:0}],
  frequency: [{position:0,value:100},{position:.33,value:10},{position:.66,value:10},{position:1,value:100}],
};
export function axisValue(position, points, min, max) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 6 || points[0].position !== 0 || points.at(-1).position !== 1 || points.some((p,i) => !Number.isFinite(p.position) || !Number.isFinite(p.value) || p.value < min || p.value > max || (i && p.position <= points[i-1].position))) throw Error('触控轴映射无效');
  const p = Math.min(1,Math.max(0,position));
  const i = points.findIndex((point,i) => i < points.length-1 && p >= point.position && p <= points[i+1].position);
  const a = points[i], b = points[i+1];
  return Math.round(a.value + (b.value-a.value)*(p-a.position)/(b.position-a.position));
}
export function touchFrame({x,y,swapAxes=false,intensity=defaultAxes.intensity,frequency=defaultAxes.frequency,mode='classic',gradientMode='both'}, gradient = {}) {
  if (![x,y].every(v=>Number.isFinite(v)&&v>=0&&v<=1) || !['classic','gradient'].includes(mode) || !['both','left','right'].includes(gradientMode)) throw Error('触控位置或模式无效');
  const a = swapAxes ? y : x, b = swapAxes ? x : y;
  let percent = axisValue(a,intensity,0,100), period = axisValue(b,frequency,10,100);
  if (mode === 'gradient') {
    const points = gradientMode === 'both' ? [0,.33,.66,1] : [0,.5,1];
    if (gradient.active) {
      gradient.percent += gradient.type === 'decrement' ? -gradient.delta : gradient.delta;
      if (gradient.percent <= 0 || gradient.percent >= 100) { gradient.percent = Math.min(100,Math.max(0,gradient.percent)); gradient.active = false; }
    } else {
      const left = gradientMode !== 'right' && a < points[1], right = gradientMode !== 'left' && a > points.at(-2);
      if (left || right) {
        const start = left ? points[0] : points.at(-2), end = left ? points[1] : points.at(-1);
        const values = left ? [6,8,10,15,20,25,35,50,100] : [100,50,35,25,20,15,10,8,6];
        Object.assign(gradient,{active:true,type:left?'decrement':'increment',delta:values[Math.min(8,Math.floor((a-start)/(end-start)*9))],percent:left?100:0});
      } else gradient.percent = 100;
    }
    percent = gradient.percent;
  }
  const f1 = Math.floor(16*Math.sqrt(period/1000));
  return [f1,period-f1,Math.floor(percent/5)];
}
