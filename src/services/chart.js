function formatLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const month = d.toLocaleDateString('ar', { month: 'short' });
  const day = d.getUTCDate();
  return `${day} ${month}`;
}

function buildChartConfig(labels, data) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'الوزن (كغ)',
          data,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.1)',
          tension: 0.2,
          fill: true,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: false,
          title: { display: true, text: 'كغ' },
        },
      },
    },
  };
}

function getChartUrl(entries) {
  let labels, data;
  if (!entries || entries.length === 0) {
    // Demo chart for testing (no data yet)
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    labels = [formatLabel(yesterday.toISOString().slice(0, 10)), formatLabel(today.toISOString().slice(0, 10))];
    data = [70, 70.5];
  } else if (entries.length === 1) {
    labels = [formatLabel(entries[0].date), formatLabel(entries[0].date)];
    data = [entries[0].weight, entries[0].weight];
  } else {
    labels = entries.map((e) => formatLabel(e.date));
    data = entries.map((e) => e.weight);
  }
  const config = buildChartConfig(labels, data);
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}`;
}

module.exports = { getChartUrl, formatLabel };
