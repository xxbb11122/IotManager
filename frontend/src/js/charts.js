import Chart from 'chart.js/auto';

let chartCpu = null, chartTrend = null;
const trendData = Array(12).fill(0);

export function loadCharts(devices, { recordTrend = false } = {}) {
  devices = Array.isArray(devices) ? devices : [];

  // CPU distribution
  const buckets = { '0-20%': 0, '20-40%': 0, '40-60%': 0, '60-80%': 0, '80-100%': 0 };
  devices.forEach(d => {
    const cpu = d.cpuUsage || 0;
    if (cpu < 20) buckets['0-20%']++;
    else if (cpu < 40) buckets['20-40%']++;
    else if (cpu < 60) buckets['40-60%']++;
    else if (cpu < 80) buckets['60-80%']++;
    else buckets['80-100%']++;
  });

  const ctx1 = document.getElementById('chart-cpu');
  if (ctx1) {
    if (chartCpu) {
      chartCpu.data.datasets[0].data = Object.values(buckets);
      chartCpu.update('none');
    } else {
      chartCpu = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: Object.keys(buckets),
        datasets: [{
          data: Object.values(buckets),
          backgroundColor: ['#3699FF','#3699FF','#3699FF','#F5A623','#F64E60'],
          borderRadius: 4,
          barThickness: 28
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7E8299', stepSize: 1 } },
          x: { grid: { display: false }, ticks: { color: '#7E8299', font: { size: 10 } } }
        }
      }
      });
    }
  }

  // Online trend
  const online = devices.filter(d => d.status === 'ONLINE').length;
  if (recordTrend) {
    trendData.push(online);
    if (trendData.length > 12) trendData.shift();
  } else {
    trendData[trendData.length - 1] = online;
  }

  const ctx2 = document.getElementById('chart-trend');
  if (ctx2) {
    if (chartTrend) {
      chartTrend.data.datasets[0].data = [...trendData];
      chartTrend.update('none');
    } else {
      chartTrend = new Chart(ctx2, {
      type: 'line',
      data: {
        labels: trendData.map((_, i) => 'T-' + (trendData.length - i - 1)),
        datasets: [{
          data: trendData,
          borderColor: '#0FE87B',
          backgroundColor: 'rgba(15,232,123,0.08)',
          fill: true, tension: 0.4,
          borderWidth: 2, pointRadius: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7E8299' }, min: 0 },
          x: { grid: { display: false }, ticks: { color: '#7E8299', font: { size: 9 } } }
        }
      }
      });
    }
  }
}

export function updateTrendData(onlineCount) {
  trendData.push(onlineCount);
  if (trendData.length > 12) trendData.shift();
}
