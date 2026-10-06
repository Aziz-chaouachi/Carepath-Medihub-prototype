import pandas as pd
import json

# 1. Read the Excel file and convert it to a JSON string
records = pd.read_excel('facilities.xlsx').to_dict(orient='records')
json_data = json.dumps(records)

# 2. Read your HTML file, replace the placeholder, and save the result
with open('index.html', 'r') as file: html_content = file.read()
with open('index.html', 'w') as file: file.write(html_content.replace('/*INJECT_JSON_HERE*/', json_data))