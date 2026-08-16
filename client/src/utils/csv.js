/**
 * Triggers a browser download of a CSV file generated from an array of items.
 *
 * @param {string} filename - Base name of the file (without extension)
 * @param {Array<{label: string, get: (item: any) => any}>} fields - Header definitions & extractor functions
 * @param {Array<any>} rows - Array of objects to export
 */
export function exportToCsv(filename, fields, rows) {
  if (!rows || !rows.length) {
    alert('No data available to export.');
    return;
  }

  const escapeCsvField = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerLine = fields.map((f) => escapeCsvField(f.label)).join(',');
  const rowLines = rows.map((row) =>
    fields.map((f) => escapeCsvField(f.get(row))).join(',')
  );

  const csvText = '\uFEFF' + [headerLine, ...rowLines].join('\r\n'); // UTF-8 BOM for Excel compatibility
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  link.setAttribute('download', `${filename}_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
