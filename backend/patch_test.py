import re

with open('backend/tests/Feature/Api/V2/CurrentProfileControllerTest.php', 'r') as f:
    content = f.read()

content = content.replace('$response->assertCreated();', '$response->dd();\n        $response->assertCreated();')
content = content.replace('$response->assertOk();', '$response->dd();\n        $response->assertOk();')

with open('backend/tests/Feature/Api/V2/CurrentProfileControllerTest.php', 'w') as f:
    f.write(content)
