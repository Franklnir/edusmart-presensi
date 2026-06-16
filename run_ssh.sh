#!/usr/bin/expect -f
set timeout 20
set user [lindex $argv 0]
set host [lindex $argv 1]
set password [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -o StrictHostKeyChecking=no $user@$host "$cmd"
expect {
    "assword:" {
        send "$password\r"
        exp_continue
    }
    eof
}
