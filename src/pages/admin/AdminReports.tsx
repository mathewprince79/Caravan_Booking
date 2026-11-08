import { useEffect, useState } from 'react';
import type { ReportSummary, ReturnRecord } from '../../../shared/types';
import { api, errorMessage, mediaUrl } from '../../lib/api';
import { Banner, Spinner } from '../../components/ui';
import { formatDate, formatRange } from '../../../shared/dates';

export default function AdminReports() {
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ reports: ReportSummary[]; returns: ReturnRecord[] }>('/api/admin/reports')
      .then((data) => {
        setReports(data.reports);
        setReturns(data.returns);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div className="stack">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {!reports ? <Spinner label="Loading reports" /> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Condition reports</h2>
            <p>Photos and videos uploaded at pickup and return.</p>
          </div>
        </div>
        {reports && reports.length === 0 ? <p className="small muted">Nothing uploaded yet.</p> : null}
        <div className="stack">
          {reports?.map((report) => {
            const url = mediaUrl(report.mediaKey);
            const isImage = report.mediaType.startsWith('image/');
            return (
              <div key={report.id} className="report-slot">
                <div className="row-between">
                  <strong>
                    {report.itemName} · {report.kind === 'start' ? 'Pickup' : 'Return'} report
                  </strong>
                  <span className="small muted">{formatDate(report.createdAt.slice(0, 10))}</span>
                </div>
                <p className="small muted">
                  {report.userName} · booking {report.startDate && report.endDate ? formatRange(report.startDate, report.endDate) : ''}
                </p>
                {report.notes ? <p className="small">“{report.notes}”</p> : null}
                {url ? (
                  isImage ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      <img className="media-preview" src={url} alt={`${report.kind} condition report`} />
                    </a>
                  ) : (
                    <a href={url} target="_blank" rel="noreferrer" className="button button-secondary button-small">
                      Open video
                    </a>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Parking addresses</h2>
            <p>Where each item was left after a booking.</p>
          </div>
        </div>
        {returns.length === 0 ? <p className="small muted">No addresses recorded yet.</p> : null}
        <div className="list">
          {returns.map((record) => (
            <div key={record.bookingId} className="list-row">
              <div>
                <strong>{record.itemName}</strong>
                <div className="small">{record.address}</div>
                {record.notes ? <div className="tiny muted">{record.notes}</div> : null}
              </div>
              <div className="tiny muted" style={{ textAlign: 'right' }}>
                {record.userName}
                <br />
                {record.startDate && record.endDate ? formatRange(record.startDate, record.endDate) : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
