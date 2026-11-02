//! A small HTTP server for tests: answers each request with what a handler says.

#![allow(dead_code)]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

type Handler = dyn Fn(usize, &str, &str) -> (u16, Vec<u8>) + Send + Sync;

/// A server that answers `handler(request number from 1, path)` with `(status, body)`.
pub struct Server {
    pub url: String,
    pub requests: Arc<Mutex<Vec<String>>>,
    /// The request line and headers of each request, as received.
    pub heads: Arc<Mutex<Vec<String>>>,
    pub max_in_flight: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
}

impl Server {
    pub fn start(
        delay: Duration,
        handler: impl Fn(usize, &str) -> (u16, String) + Send + Sync + 'static,
    ) -> Server {
        Self::start_with_body(delay, move |n, path, _| handler(n, path))
    }

    /// As [`Server::start`], and the handler is given the request body too.
    pub fn start_with_body(
        delay: Duration,
        handler: impl Fn(usize, &str, &str) -> (u16, String) + Send + Sync + 'static,
    ) -> Server {
        Self::start_bytes(delay, move |n, path, body| {
            let (status, answer) = handler(n, path, body);
            (status, answer.into_bytes())
        })
    }

    /// As [`Server::start_with_body`], answering with bytes.
    pub fn start_bytes(
        delay: Duration,
        handler: impl Fn(usize, &str, &str) -> (u16, Vec<u8>) + Send + Sync + 'static,
    ) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/geo", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let heads = Arc::new(Mutex::new(Vec::new()));
        let in_flight = Arc::new(AtomicUsize::new(0));
        let max_in_flight = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let handler = Arc::new(handler);
        {
            let (requests, heads, in_flight, max_in_flight, stop) = (
                requests.clone(),
                heads.clone(),
                in_flight.clone(),
                max_in_flight.clone(),
                stop.clone(),
            );
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(stream) = stream else { continue };
                    let (requests, heads, in_flight, max_in_flight, handler) = (
                        requests.clone(),
                        heads.clone(),
                        in_flight.clone(),
                        max_in_flight.clone(),
                        handler.clone(),
                    );
                    std::thread::spawn(move || {
                        Self::respond(
                            stream,
                            delay,
                            &requests,
                            &heads,
                            &in_flight,
                            &max_in_flight,
                            &*handler,
                        )
                    });
                }
            });
        }
        Server {
            url,
            requests,
            heads,
            max_in_flight,
            stop,
        }
    }

    fn respond(
        mut stream: TcpStream,
        delay: Duration,
        requests: &Mutex<Vec<String>>,
        heads: &Mutex<Vec<String>>,
        in_flight: &AtomicUsize,
        max_in_flight: &AtomicUsize,
        handler: &Handler,
    ) {
        let mut buffer = [0u8; 4096];
        let mut received = Vec::new();
        while !received.windows(4).any(|w| w == b"\r\n\r\n") {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(n) => received.extend_from_slice(&buffer[..n]),
            }
        }
        // The body: whatever follows the head, up to Content-Length.
        let head_end = received.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        let head = String::from_utf8_lossy(&received[..head_end]).into_owned();
        let length = head
            .lines()
            .find_map(|l| {
                l.to_lowercase()
                    .strip_prefix("content-length:")
                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
            })
            .unwrap_or(0);
        while received.len() < head_end + length {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => received.extend_from_slice(&buffer[..n]),
            }
        }
        let body = String::from_utf8_lossy(&received[head_end..]).into_owned();
        let text = std::borrow::Cow::Borrowed(head.as_str());
        heads.lock().unwrap().push(text.to_string());
        let path = text.split_whitespace().nth(1).unwrap_or("").to_owned();
        let number = {
            let mut requests = requests.lock().unwrap();
            requests.push(path.clone());
            requests.len()
        };
        let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        max_in_flight.fetch_max(now, Ordering::SeqCst);
        std::thread::sleep(delay);
        let (status, answer) = handler(number, &path, &body);
        in_flight.fetch_sub(1, Ordering::SeqCst);
        let _ = write!(
            stream,
            "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            answer.len()
        );
        let _ = stream.write_all(&answer);
    }

    pub fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }

    pub fn paths(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the accept loop so it sees the flag.
        let _ = TcpStream::connect(
            self.url
                .trim_start_matches("http://")
                .trim_end_matches("/geo"),
        );
    }
}
