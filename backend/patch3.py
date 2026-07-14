import re

with open('backend/tests/Feature/Api/V2/CurrentProfileControllerTest.php', 'r') as f:
    content = f.read()

content = content.replace("'data.profile.nama'", "'data.nama'")
content = content.replace("'data.profile.role'", "'data.role'")

with open('backend/tests/Feature/Api/V2/CurrentProfileControllerTest.php', 'w') as f:
    f.write(content)
