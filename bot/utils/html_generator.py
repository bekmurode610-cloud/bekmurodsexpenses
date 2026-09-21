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
    
    # Prepare data for Chart.js
    # 1. Weekly Group Trend
    weekly_group_chart_data = [weekly_group[k] for k in week_keys]
    
    # 2. Monthly Group Trend
    monthly_group_chart_data = [monthly_group[k] for k in month_keys]
    
    # 3. Weekly Members Trend (Datasets)
    # 4. Monthly Members Trend (Datasets)
    # Assign distinct colors to members
    colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF', '#8A2BE2', '#00FA9A', '#DC143C']
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
            'fill': False,
            'tension': 0.1
        })
        
        m_data = []
        for k in month_keys:
            m_data.append(monthly_members.get(k, {}).get(member, 0))
        monthly_member_datasets.append({
            'label': member,
            'data': m_data,
            'borderColor': member_colors[member],
            'fill': False,
            'tension': 0.1
        })
        
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{group_name} - Analytics Report</title>
    <!-- Pico.css for clean styling without external heavy frameworks -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
    <!-- Chart.js for lightweight graphs -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        .chart-container {{ position: relative; height: 400px; width: 100%; margin-bottom: 3rem; }}
        table {{ font-size: 0.9rem; }}
    </style>
</head>
<body>
    <main class="container">
        <hgroup>
            <h1>{group_name} - Analytics Report</h1>
            <h2>Visual breakdown of expenses (Primary Currency: {primary_currency})</h2>
        </hgroup>
        
        <!-- Toggle weekly/monthly -->
        <fieldset>
            <legend>Select Timeframe</legend>
            <label for="radio-weekly">
                <input type="radio" id="radio-weekly" name="timeframe" value="weekly" checked onclick="toggleTimeframe('weekly')">
                Weekly
            </label>
            <label for="radio-monthly">
                <input type="radio" id="radio-monthly" name="timeframe" value="monthly" onclick="toggleTimeframe('monthly')">
                Monthly
            </label>
        </fieldset>

        <section id="weekly-section">
            <h3>Weekly Group Overall Trend</h3>
            <div class="chart-container">
                <canvas id="weeklyGroupChart"></canvas>
            </div>
            
            <h3>Weekly Member Trends</h3>
            <div class="chart-container">
                <canvas id="weeklyMemberChart"></canvas>
            </div>
        </section>
        
        <section id="monthly-section" style="display: none;">
            <h3>Monthly Group Overall Trend</h3>
            <div class="chart-container">
                <canvas id="monthlyGroupChart"></canvas>
            </div>
            
            <h3>Monthly Member Trends</h3>
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
        
        // Weekly Group
        new Chart(document.getElementById('weeklyGroupChart'), {{
            type: 'line',
            data: {{
                labels: weekKeys,
                datasets: [{{
                    label: 'Total Expenses (' + currency + ')',
                    data: {json.dumps(weekly_group_chart_data)},
                    borderColor: '#2D9CDB',
                    backgroundColor: 'rgba(45, 156, 219, 0.2)',
                    fill: true,
                    tension: 0.1
                }}]
            }},
            options: {{ responsive: true, maintainAspectRatio: false }}
        }});
        
        // Weekly Members
        new Chart(document.getElementById('weeklyMemberChart'), {{
            type: 'line',
            data: {{
                labels: weekKeys,
                datasets: {json.dumps(weekly_member_datasets)}
            }},
            options: {{ responsive: true, maintainAspectRatio: false }}
        }});
        
        // Monthly Group
        new Chart(document.getElementById('monthlyGroupChart'), {{
            type: 'line',
            data: {{
                labels: monthKeys,
                datasets: [{{
                    label: 'Total Expenses (' + currency + ')',
                    data: {json.dumps(monthly_group_chart_data)},
                    borderColor: '#9B51E0',
                    backgroundColor: 'rgba(155, 81, 224, 0.2)',
                    fill: true,
                    tension: 0.1
                }}]
            }},
            options: {{ responsive: true, maintainAspectRatio: false }}
        }});
        
        // Monthly Members
        new Chart(document.getElementById('monthlyMemberChart'), {{
            type: 'line',
            data: {{
                labels: monthKeys,
                datasets: {json.dumps(monthly_member_datasets)}
            }},
            options: {{ responsive: true, maintainAspectRatio: false }}
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
