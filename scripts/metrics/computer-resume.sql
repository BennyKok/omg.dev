BEGIN READ ONLY;
WITH samples AS (
  SELECT e.event_id, e.created_at,
    max(d.number_value) FILTER (WHERE d.data_key = 'duration_ms') / 1000 AS seconds,
    max(d.string_value) FILTER (WHERE d.data_key = 'result') AS result
  FROM website_event e
  JOIN event_data d ON d.website_event_id = e.event_id
  WHERE e.event_name = 'computer_resume'
    AND e.created_at >= now() - (:'days' || ' days')::interval
  GROUP BY e.event_id, e.created_at
)
SELECT coalesce(to_char(date_trunc('day', created_at), 'YYYY-MM-DD'), 'TOTAL') AS day,
  count(*) FILTER (WHERE result = 'connected') AS completed,
  round(avg(seconds) FILTER (WHERE result = 'connected'), 2) AS average_seconds,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) FILTER (WHERE result = 'connected'))::numeric, 2) AS p50_seconds,
  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY seconds) FILTER (WHERE result = 'connected'))::numeric, 2) AS p95_seconds,
  count(*) FILTER (WHERE result = 'failed') AS failed,
  count(*) FILTER (WHERE result = 'abandoned') AS abandoned
FROM samples
GROUP BY GROUPING SETS ((), (date_trunc('day', created_at)))
ORDER BY day DESC;
COMMIT;
