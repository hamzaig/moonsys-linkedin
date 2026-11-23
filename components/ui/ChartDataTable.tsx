export default function ChartDataTable({ caption, columns, rows }: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return <details className="mt-5 border-t border-base-300 pt-3 text-xs">
    <summary className="w-fit rounded text-muted">View chart data</summary>
    <div className="mt-3 max-h-64 overflow-auto">
      <table className="table table-xs">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, column) => column === 0
          ? <th key={column} scope="row">{value}</th>
          : <td key={column}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </details>;
}
