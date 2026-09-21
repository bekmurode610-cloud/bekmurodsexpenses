import json
from typing import Dict, Any

def generate_analytics_html(data: Dict[str, Any]) -> str:
    group_name = data.get('group_name', 'Unknown Group')
    primary_currency = data.get('primary_currency', '')
    members = data.get('members', [])
    weekly_group = data.get('weekly_group', {})
    monthly_group = data.get('monthly_group', {})
    weekly_members = data.get('weekly_members', {})
    monthly_members = data.get('monthly_members', {})
    raw_data = data.get('raw_data', [])
    
    # Sort keys
    week_keys = sorted(list(weekly_group.keys()))
    month_keys = sorted(list(monthly_group.keys()))
    
    # Pad to ensure lines are drawn if there is only 1 data point
    if len(week_keys) == 1:
        parts = week_keys[0].split('-W')
        if len(parts) == 2:
            yr, wk = int(parts[0]), int(parts[1])
            prev_week = f"{yr}-W{wk-1:02d}" if wk > 1 else f"{yr-1}-W52"
            week_keys.insert(0, prev_week)
            weekly_group[prev_week] = 0

    if len(month_keys) == 1:
        parts = month_keys[0].split('-')
        if len(parts) == 2:
            yr, mo = int(parts[0]), int(parts[1])
            prev_month = f"{yr}-{mo-1:02d}" if mo > 1 else f"{yr-1}-12"
            month_keys.insert(0, prev_month)
            monthly_group[prev_month] = 0
            
    # Premium colors matching the reference
    colors = ['#005b96', '#d32f2f', '#ff8a65', '#424242', '#689f38', '#fbc02d', '#7b1fa2', '#0097a7']
    member_colors = {m: colors[i % len(colors)] for i, m in enumerate(members)}
    
    weekly_member_datasets = []
    monthly_member_datasets = []
    
    for member in members:
        w_data = []
        for k in week_keys:
            w_data.append(weekly_members.get(k, {}).get(member, 0))
        weekly_member_datasets.append({
            'label': member,
            'data': w_data,
            'borderColor': member_colors[member],
            'borderWidth': 2,
            'backgroundColor': member_colors[member]
        })
        
        m_data = []
        for k in month_keys:
            m_data.append(monthly_members.get(k, {}).get(member, 0))
        monthly_member_datasets.append({
            'label': member,
            'data': m_data,
            'borderColor': member_colors[member],
            'borderWidth': 2,
            'backgroundColor': member_colors[member]
        })
        
    html = f"""<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{group_name} - Analytics Report</title>
    <!-- Pico.css for layout -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
    <!-- Chart.js for graphs -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {{
            background-color: #f7f9fc; /* Very light subtle background */
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #212121;
        }}
        .report-card {{
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
            padding: 40px;
            margin-top: 40px;
            margin-bottom: 40px;
            border-top: 6px solid #d32f2f; /* Premium red line on top */
        }}
        h1 {{
            font-size: 1.8rem;
            font-weight: 700;
            color: #212121;
            margin-bottom: 0.2rem;
        }}
        h2 {{
            font-size: 1.1rem;
            font-weight: 400;
            color: #616161;
            margin-bottom: 2rem;
        }}
        h3 {{
            font-size: 1.2rem;
            font-weight: 600;
            color: #424242;
            margin-top: 2rem;
            margin-bottom: 1rem;
        }}
        .chart-container {{ 
            position: relative; 
            height: 450px; 
            width: 100%; 
            margin-bottom: 3rem; 
        }}
        .toggle-group {{
            display: flex;
            gap: 15px;
            margin-bottom: 2rem;
        }}
        .toggle-group label {{
            font-size: 0.95rem;
            font-weight: 500;
            cursor: pointer;
        }}
        table {{ font-size: 0.9rem; }}
        th {{ background-color: #f5f5f5 !important; color: #424242 !important; font-weight: 600 !important; }}
    </style>
</head>
<body>
    <main class="container report-card">
        <hgroup>
            <h1>Evolution of Expenses in {group_name}</h1>
            <h2>Focus on tracked spending patterns (Primary Currency: {primary_currency})</h2>
        </hgroup>
        
        <!-- Toggle weekly/monthly -->
        <div class="toggle-group">
            <label for="radio-weekly">
                <input type="radio" id="radio-weekly" name="timeframe" value="weekly" checked onclick="toggleTimeframe('weekly')">
                Weekly View
            </label>
            <label for="radio-monthly">
                <input type="radio" id="radio-monthly" name="timeframe" value="monthly" onclick="toggleTimeframe('monthly')">
                Monthly View
            </label>
        </div>

        <section id="weekly-section">
            <div class="chart-container">
                <canvas id="weeklyGroupChart"></canvas>
            </div>
            
            <div class="chart-container">
                <canvas id="weeklyMemberChart"></canvas>
            </div>
        </section>
        
        <section id="monthly-section" style="display: none;">
            <div class="chart-container">
                <canvas id="monthlyGroupChart"></canvas>
            </div>
            
            <div class="chart-container">
                <canvas id="monthlyMemberChart"></canvas>
            </div>
        </section>
        
        <hr>
        
        <section>
            <h3>Raw Data Log</h3>
            <figure>
                <table role="grid">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Payer</th>
                            <th>Amount</th>
                            <th>Currency</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
"""
    # Append raw data
    for row in raw_data:
        html += f"""
                        <tr>
                            <td>{row['date']}</td>
                            <td>{row['payer']}</td>
                            <td>{row['amount']:.2f}</td>
                            <td>{row['currency']}</td>
                            <td>{row['description']}</td>
                        </tr>"""

    html += f"""
                    </tbody>
                </table>
            </figure>
        </section>
    </main>

    <script>
        const weekKeys = {json.dumps(week_keys)};
        const monthKeys = {json.dumps(month_keys)};
        const currency = "{primary_currency}";
        
        // Common chart styling to match premium aesthetics
        const commonOptions = {{
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {{
                legend: {{
                    position: 'top',
                    align: 'start',
                    labels: {{
                        usePointStyle: true,
                        boxWidth: 8,
                        boxHeight: 8,
                        font: {{ size: 12, family: "'Helvetica Neue', Helvetica, Arial, sans-serif" }},
                        color: '#424242'
                    }}
                }},
                tooltip: {{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#212121',
                    bodyColor: '#424242',
                    borderColor: '#e0e0e0',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 6,
                    usePointStyle: true
                }}
            }},
            scales: {{
                x: {{
                    grid: {{ color: '#f0f0f0', drawBorder: false }},
                    ticks: {{ color: '#757575', font: {{ size: 11 }} }}
                }},
                y: {{
                    grid: {{ color: '#f0f0f0', drawBorder: false }},
                    ticks: {{ color: '#757575', font: {{ size: 11 }} }}
                }}
            }},
            interaction: {{ mode: 'index', intersect: false }}
        }};

        // Function to only show points at the end of the line
        const customPointRadius = (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 6 : 0;
        const customHoverRadius = (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 8 : 4;
        const customPointStyle = (ctx) => {{
            const ds = ctx.dataset;
            ds.pointBackgroundColor = ds.borderColor;
            ds.pointBorderColor = 'rgba(255, 255, 255, 0.8)';
            ds.pointBorderWidth = 2;
            ds.fill = false;
            ds.tension = 0.3; // Slight curve
        }};

        // Weekly Group
        const wgData = [{{
            label: 'Total Expenses (' + currency + ')',
            data: weekKeys.map(k => {{ return {json.dumps(weekly_group)}[k] || 0; }}),
            borderColor: '#005b96',
            backgroundColor: '#005b96',
            borderWidth: 2,
            pointRadius: customPointRadius,
            pointHoverRadius: customHoverRadius
        }}];
        wgData.forEach(customPointStyle);

        new Chart(document.getElementById('weeklyGroupChart'), {{
            type: 'line',
            data: {{ labels: weekKeys, datasets: wgData }},
            options: {{
                ...commonOptions,
                plugins: {{ ...commonOptions.plugins, title: {{ display: true, text: 'Total Group Expenses Over Time', align: 'start', color: '#212121', font: {{ size: 14 }} }} }}
            }}
        }});
        
        // Weekly Members
        let weeklyMemberDatasets = {json.dumps(weekly_member_datasets)};
        weeklyMemberDatasets.forEach(ds => {{
            ds.pointRadius = customPointRadius;
            ds.pointHoverRadius = customHoverRadius;
            customPointStyle({{dataset: ds}});
        }});

        new Chart(document.getElementById('weeklyMemberChart'), {{
            type: 'line',
            data: {{ labels: weekKeys, datasets: weeklyMemberDatasets }},
            options: {{
                ...commonOptions,
                plugins: {{ ...commonOptions.plugins, title: {{ display: true, text: 'Individual Spending Over Time', align: 'start', color: '#212121', font: {{ size: 14 }} }} }}
            }}
        }});
        
        // Monthly Group
        const mgData = [{{
            label: 'Total Expenses (' + currency + ')',
            data: monthKeys.map(k => {{ return {json.dumps(monthly_group)}[k] || 0; }}),
            borderColor: '#d32f2f',
            backgroundColor: '#d32f2f',
            borderWidth: 2,
            pointRadius: customPointRadius,
            pointHoverRadius: customHoverRadius
        }}];
        mgData.forEach(customPointStyle);

        new Chart(document.getElementById('monthlyGroupChart'), {{
            type: 'line',
            data: {{ labels: monthKeys, datasets: mgData }},
            options: {{
                ...commonOptions,
                plugins: {{ ...commonOptions.plugins, title: {{ display: true, text: 'Total Group Expenses Over Time', align: 'start', color: '#212121', font: {{ size: 14 }} }} }}
            }}
        }});
        
        // Monthly Members
        let monthlyMemberDatasets = {json.dumps(monthly_member_datasets)};
        monthlyMemberDatasets.forEach(ds => {{
            ds.pointRadius = customPointRadius;
            ds.pointHoverRadius = customHoverRadius;
            customPointStyle({{dataset: ds}});
        }});

        new Chart(document.getElementById('monthlyMemberChart'), {{
            type: 'line',
            data: {{ labels: monthKeys, datasets: monthlyMemberDatasets }},
            options: {{
                ...commonOptions,
                plugins: {{ ...commonOptions.plugins, title: {{ display: true, text: 'Individual Spending Over Time', align: 'start', color: '#212121', font: {{ size: 14 }} }} }}
            }}
        }});
        
        function toggleTimeframe(frame) {{
            if(frame === 'weekly') {{
                document.getElementById('weekly-section').style.display = 'block';
                document.getElementById('monthly-section').style.display = 'none';
            }} else {{
                document.getElementById('weekly-section').style.display = 'none';
                document.getElementById('monthly-section').style.display = 'block';
            }}
        }}
    </script>
</body>
</html>
"""
    return html
